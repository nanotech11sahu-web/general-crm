import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { createSystemOps, migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { ConnectionService, FsObjectStore, LeadService, MessagingService, PrivacyService, RetentionService, TenantDataService, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let router2: TenantDbRouter; let db2: any; let keys: LocalKeyService; let leads: LeadService; let sys: any;
const dir = mkdtempSync(join(tmpdir(), 'ld-priv-')); const store = new FsObjectStore(dir, 'x'.repeat(32));
const NOW = new Date('2026-03-10T06:30:00Z'); const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
let phone = 5000000; const nextPhone = () => `95${String(++phone).padStart(8, '0')}`;
const fakeSms: Connector = { manifest: { id: 'fake-sms', category: 'sms', displayName: 'x', logo: '', docsUrl: '', auth: { type: 'api_key' }, capabilities: ['msg.send'], credentialFields: [{ key: 'token', label: 't', type: 'secret', required: true }], configFields: [] }, async verify() { return { ok: true }; }, async health() { return { ok: true }; }, async send() { return { providerMessageId: 'pm' }; } };
const registry = new ConnectorRegistry().register(fakeSms);

async function mkTenant(slug: string) {
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug }));
  const id = String(t._id); await as(id, () => seedPreset(db.repos, 'generic')); return id;
}
async function fullLead(T: string, name = 'Priya Shah') {
  const p = nextPhone();
  const id = ((await as(T, () => leads.intake({ name, contacts: [{ value: p }, { value: `${name.split(' ')[0].toLowerCase()}@x.io` }], city: 'Pune', metaLeadId: `meta-${p}` } as any))) as any).leadId as string;
  await store.put(`tenants/${T}/recordings/${id}.mp3`, Buffer.from('audio'), 'audio/mpeg');
  await as(T, async () => {
    const R = db.repos; const conn: any = await R.connections.create({ provider: 'fake-sms', category: 'sms', name: 'S', publicId: `pub-${p}`, status: 'verified', secretCiphertext: Buffer.from('sealed'), secretWrappedDek: Buffer.from('dek'), secretKeyRef: 'local' });
    const conv: any = await R.conversations.create({ leadId: id, channel: 'sms', connectionId: conn._id, externalThreadId: `+91${p}` });
    await R.messages.create({ conversationId: conv._id, leadId: id, direction: 'in', channel: 'sms', body: 'hello there', status: 'received', providerMessageId: `in-${p}` });
    await R.tasks.create({ leadId: id, assigneeId: '65f000000000000000000001', dueAt: ago(-1), contextNote: 'Call back about the visit', status: 'open' });
    await R.callSessions.create({ leadId: id, agentId: '65f000000000000000000001', state: 'ended', startedAt: ago(3), recordingObjectKey: `tenants/${T}/recordings/${id}.mp3` });
    await R.merges.create({ winnerId: id, loserId: '65f0000000000000000000ee', snapshot: { contacts: [{ valueNorm: '+91999' }] } });
    await R.inbox.create({ connectionId: conn._id, provider: 'meta-leadads', externalEventId: `meta-${p}`, signatureValid: true, status: 'done', rawPayload: { field_data: [{ name: 'phone', values: [p] }] } });
    await R.notifications.create({ audience: 'managers', kind: 'task.missed', payload: { leadId: id, leadName: name } });
  });
  return { id, p };
}

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('priv_main'); const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  const url2 = rs.getUri('priv_restore'); const c2 = await MongoClient.connect(url2); await migrateUp(c2.db()); await c2.close();
  router = new TenantDbRouter(url); db = await router.connect(); router2 = new TenantDbRouter(url2); db2 = await router2.connect();
  keys = new LocalKeyService(randomBytes(32)); leads = new LeadService(db); sys = createSystemOps(db.models);
});
afterAll(async () => { await router.close(); await router2.close(); await rs.stop(); });

describe('subject access and erasure (one lead)', () => {
  it('exports everything held about a person, without secrets or recording keys', async () => {
    const T = await mkTenant('p1'); const { id } = await fullLead(T);
    const x: any = await as(T, () => new PrivacyService(db, store).exportLead(id));
    expect(x.lead.displayName).toBe('Priya Shah'); expect(x.messages.map((m: any) => m.body)).toEqual(['hello there']);
    expect(x.tasks).toHaveLength(1); expect(x.calls[0]).toMatchObject({ hasRecording: true }); expect(JSON.stringify(x)).not.toContain('recordings/');
    expect(x.activities.length).toBeGreaterThan(0); expect(x.version).toBe(1);
  });

  it('erasure removes the lead, thread, tasks, calls, merge snapshots, raw events and recordings; leaves a phone-hash suppression and a PII-free audit row', async () => {
    const T = await mkTenant('p2'); const { id, p } = await fullLead(T); const other = await fullLead(T, 'Keep Me');
    const key = `tenants/${T}/recordings/${id}.mp3`; expect(existsSync(join(dir, key))).toBe(true);
    const r: any = await as(T, () => new PrivacyService(db, store).eraseLead(id, { reason: 'subject request' }));
    expect(r).toMatchObject({ erased: true, recordingsDeleted: 1, counts: expect.objectContaining({ messages: 1, conversations: 1, tasks: 1, calls: 1, merges: 1, rawEvents: 1, leads: 1 }) });
    await as(T, async () => {
      const R = db.repos;
      expect(await R.leads.findById(id)).toBeNull(); expect(await R.messages.count({ leadId: id })).toBe(0); expect(await R.activities.count({ leadId: id })).toBe(0);
      expect(await R.contactIndex.count({ leadId: id })).toBe(0); expect(await R.merges.count({ winnerId: id })).toBe(0); expect(await R.inbox.count({ externalEventId: `meta-${p}` })).toBe(0);
      expect(await R.notifications.count({ 'payload.leadId': id })).toBe(0);
      expect(await R.leads.findById(other.id)).toBeTruthy(); expect(await R.messages.count({ leadId: other.id })).toBe(1); // somebody else's data is untouched
      const audit: any = await R.audit.findOne({ action: 'privacy.lead_erased' });
      expect(audit.entityId).toBe(id); expect(JSON.stringify(audit)).not.toMatch(/Priya|priya|9500|@x\.io/);
      expect(await new PrivacyService(db, store).isSuppressed(`+91${p}`)).toBe(true); expect(await new PrivacyService(db, store).isSuppressed('+919999999999')).toBe(false);
    });
    expect(existsSync(join(dir, key))).toBe(false);
    await expect(as(T, () => new PrivacyService(db, store).eraseLead(id))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('after erasure the platform will not message that number again', async () => {
    const T = await mkTenant('p3');
    await as(T, () => new ConnectionService(db, keys, registry).create({ provider: 'fake-sms', name: 'SMS', credentials: { token: 'tok-12345678' } }));
    const { id, p } = await fullLead(T, 'Gone Gita');
    await as(T, () => new PrivacyService(db, store).eraseLead(id));
    const again = ((await as(T, () => leads.intake({ name: 'Gone Gita', contacts: [{ value: p }] }))) as any).leadId;
    await expect(as(T, () => new MessagingService(db, keys, registry).send({ leadId: again, channel: 'sms', body: 'hi', idempotencyKey: 'k-erased-0001' }))).rejects.toMatchObject({ code: 'opted_out' });
  });

  it('is tenant-scoped: another workspace cannot export or erase this lead', async () => {
    const A = await mkTenant('p4a'); const B = await mkTenant('p4b'); const { id } = await fullLead(A);
    await expect(as(B, () => new PrivacyService(db, store).exportLead(id))).rejects.toMatchObject({ code: 'not_found' });
    await expect(as(B, () => new PrivacyService(db, store).eraseLead(id))).rejects.toMatchObject({ code: 'not_found' });
    expect(await as(A, () => db.repos.leads.findById(id))).toBeTruthy();
  });
});

describe('workspace export and the restore drill', () => {
  it('exports every collection without credentials, and the export restores into a fresh database with matching counts', async () => {
    const T = await mkTenant('x1'); await fullLead(T, 'Alpha One'); await fullLead(T, 'Beta Two');
    const u: any = await runAsSystem('test', () => db.models.User.create({ email: `own-${randomBytes(3).toString('hex')}@x.io`, name: 'Owner', passwordHash: 'argon-hash-secret' }));
    await as(T, () => db.repos.memberships.create({ userId: u._id, role: 'owner', status: 'active' }));
    const lines: string[] = []; await as(T, async () => { for await (const l of new TenantDataService(db, () => NOW).exportLines()) lines.push(l); }); // the generator must be consumed inside the tenant context
    const text = lines.join('\n');
    expect(JSON.parse(lines[0])).toMatchObject({ type: 'manifest', version: 1 });
    expect(text).not.toMatch(/secretCiphertext|secretWrappedDek|argon-hash-secret|passwordHash|refreshToken|tokenHash/);
    expect(lines.filter((l) => l.includes('"c":"Lead"')).length).toBe(2);

    const res = await TenantDataService.restoreExport(lines, db2);
    const live: Record<string, number> = {};
    for (const name of res.manifest.collections) live[name] = await as(T, async () => (db.models as any)[name].countDocuments({}));
    for (const [name, n] of Object.entries(res.restored)) if (name !== 'User') expect(n).toBe(live[name]);
    expect(Object.entries(live).filter(([, n]) => n > 0).every(([name, n]) => res.restored[name] === n)).toBe(true);
    // restored data is real: queryable, typed ids/dates, user shell without a password
    const l2: any = await runAsSystem('test', () => db2.models.Lead.findOne({ displayName: 'Alpha One' }).lean().exec());
    expect(l2.createdAt).toBeInstanceOf(Date); expect(String(l2.tenantId)).toBe(T);
    const u2: any = await db2.models.User.findById(u._id).lean().exec(); expect(u2.email).toBe(u.email); expect(u2.passwordHash).toBeUndefined();
    expect(await runAsSystem('test', () => db2.models.IntegrationConnection.findOne({}).lean().exec())).not.toHaveProperty('secretCiphertext');
    await expect(TenantDataService.restoreExport(['{"c":"Lead","d":{}}'], db2)).rejects.toMatchObject({ code: 'invalid_export' });
  });
});

describe('retention and workspace deletion', () => {
  it('removes old recordings and purges soft-deleted leads after the configured days', async () => {
    const T = await mkTenant('r1'); const a = await fullLead(T, 'Old Rec'); const b = await fullLead(T, 'Soft Gone');
    await as(T, async () => {
      await db.repos.callSessions.updateOne({ leadId: a.id }, { $set: { startedAt: ago(200) } });
      await db.repos.leads.updateOne({ _id: b.id }, { $set: { deletedAt: ago(40) } });
    });
    const svc = () => new RetentionService(db, store, () => NOW);
    await expect(as(T, () => svc().updateSettings({ recordingDays: 3 }))).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(await as(T, () => svc().run())).toEqual({ recordings: 1, leads: 1, imports: 0 });
    expect(existsSync(join(dir, `tenants/${T}/recordings/${a.id}.mp3`))).toBe(false);
    expect(((await as(T, () => db.repos.callSessions.findOne({ leadId: a.id }))) as any)).toMatchObject({ recordingObjectKey: null });
    expect(await as(T, () => db.repos.leads.findById(b.id))).toBeNull();
    expect(await as(T, () => db.repos.leads.findById(a.id))).toBeTruthy();
    expect(await as(T, () => svc().run())).toEqual({ recordings: 0, leads: 0, imports: 0 }); // idempotent
  });

  it('uploaded spreadsheets (rows and error rows) are purged after the import window, finished or abandoned, never while running; the job summary stays', async () => {
    const T = await mkTenant('imp1'); const { ObjectId } = await import('mongodb');
    const mk = (status: string, daysOld: number) => as(T, async () => {
      const j: any = await db.repos.importJobs.create({ filename: `${status}.csv`, status, headers: ['Name', 'Phone'], rowCount: 2, mapping: { Name: 'name' }, stats: { created: 2 } });
      await db.repos.importRows.createMany([{ jobId: j._id, rowNo: 1, data: ['Asha', '9812345678'] }, { jobId: j._id, rowNo: 2, data: ['Bala', '9812345679'] }]);
      await db.repos.importRowErrors.create({ jobId: j._id, rowNo: 2, raw: ['Bala', '98'], reason: 'bad phone' });
      await db.models.ImportJob.collection.updateOne({ _id: j._id }, { $set: { updatedAt: ago(daysOld) } }); return String(j._id);
    });
    const done = await mk('done', 45), abandoned = await mk('mapped', 60), recent = await mk('done', 5), running = await mk('running', 90);
    const svc = () => new RetentionService(db, store, () => NOW);
    await expect(as(T, () => svc().updateSettings({ importDays: 0 }))).rejects.toMatchObject({ code: 'invalid_settings' });
    expect((await as(T, () => svc().run())).imports).toBe(2);
    const rows = (id: string) => as(T, () => db.repos.importRows.count({ jobId: new ObjectId(id) })); const errs = (id: string) => as(T, () => db.repos.importRowErrors.count({ jobId: new ObjectId(id) }));
    expect([await rows(done), await errs(done), await rows(abandoned), await errs(abandoned)]).toEqual([0, 0, 0, 0]);
    expect([await rows(recent), await errs(recent), await rows(running)]).toEqual([2, 1, 2]); // inside the window, or still running
    const j: any = await as(T, () => db.repos.importJobs.findById(done)); expect(j).toMatchObject({ status: 'done', purgedAt: expect.any(Date), stats: { created: 2 }, filename: 'done.csv' }); expect(j.headers).toEqual([]);
    expect((await as(T, () => svc().run())).imports).toBe(0); // idempotent
    await as(T, () => svc().updateSettings({ importDays: 3 })); expect((await as(T, () => svc().run())).imports).toBe(1); // the 5-day-old one now falls outside a 3-day window
  });

  it('deletion has a grace period and can be cancelled; after it the whole workspace is purged but a shared user survives', async () => {
    const T = await mkTenant('d1'); const T2 = await mkTenant('d2'); const keep = await fullLead(T2, 'Other Tenant');
    const solo: any = await runAsSystem('test', () => db.models.User.create({ email: `solo-${randomBytes(3).toString('hex')}@x.io`, name: 'Solo', passwordHash: 'h' }));
    const shared: any = await runAsSystem('test', () => db.models.User.create({ email: `shared-${randomBytes(3).toString('hex')}@x.io`, name: 'Shared', passwordHash: 'h' }));
    await as(T, async () => { await db.repos.memberships.create({ userId: solo._id, role: 'owner', status: 'active' }); await db.repos.memberships.create({ userId: shared._id, role: 'admin', status: 'active' }); });
    await as(T2, () => db.repos.memberships.create({ userId: shared._id, role: 'agent', status: 'active' }));
    const { id } = await fullLead(T, 'Doomed');
    const svc = new TenantDataService(db, () => NOW);
    const due = (await as(T, () => svc.requestDeletion('owner-id', 14))).dueAt; expect(due.getTime()).toBe(NOW.getTime() + 14 * 86_400_000);
    expect(await RetentionService.sweepAll(db, sys, store, () => NOW)).toMatchObject({ purged: 0 }); // still in the grace period
    await as(T, () => svc.cancelDeletion()); expect(await as(T, () => svc.deletionStatus())).toBeNull();
    await as(T, () => svc.requestDeletion('owner-id', 14));
    const later = () => new Date(NOW.getTime() + 15 * 86_400_000);
    const r = await RetentionService.sweepAll(db, sys, store, later); expect(r.purged).toBe(1);
    expect(await as(T, () => db.repos.leads.findById(id))).toBeNull(); expect(await as(T, () => db.repos.memberships.count({}))).toBe(0);
    expect(existsSync(join(dir, `tenants/${T}`))).toBe(false);
    expect(await db.models.User.findById(solo._id).lean().exec()).toBeNull(); expect(await db.models.User.findById(shared._id).lean().exec()).toBeTruthy();
    expect(((await db.models.Tenant.findById(T).lean().exec()) as any)).toMatchObject({ status: 'deleted', name: 'deleted' });
    expect(await as(T2, () => db.repos.leads.findById(keep.id))).toBeTruthy(); // the neighbour is untouched
    expect((await RetentionService.sweepAll(db, sys, store, later)).purged).toBe(0); // already deleted: not purged twice
  });
});
