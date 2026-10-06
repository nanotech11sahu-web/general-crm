import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { ConnectionService, DoService, FsObjectStore, LeadService, TelephonyService, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let keys: LocalKeyService; let leads: LeadService;
const started: any[] = []; let failStart = false; let failFetch = false;
const voice: Connector = {
  manifest: { id: 'fake-voice', category: 'voice', displayName: 'Fake voice', logo: '', docsUrl: '', auth: { type: 'basic' }, capabilities: ['call.click_to_call', 'call.webhook'],
    credentialFields: [{ key: 'webhookToken', label: 'T', type: 'secret', required: true, generated: true }], configFields: [] },
  async verify() { return { ok: true }; }, async health() { return { ok: true }; },
  async startCall(_c, req) { if (failStart) throw new Error('provider down'); started.push(req); return { providerCallId: `call-${started.length}` }; },
  async fetchRecording(_c, url) { if (failFetch) throw new Error('download failed'); return { bytes: Buffer.from(`audio:${url}`), contentType: 'audio/mpeg' }; },
};
const registry = new ConnectorRegistry().register(voice);
const store = new FsObjectStore(mkdtempSync(join(tmpdir(), 'ld-rec-')), 'test-signing-secret-1234', 'https://api.test');
const svc = (now?: () => Date) => new TelephonyService(db, keys, registry, store, { publicIngressUrl: 'https://ingress.test', now });
const as = <T>(t: string, user: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: user });
let phone = 7000000;

async function mkUser(t: string, role = 'agent') {
  const u: any = await db.models.User.create({ email: `${role}-${Math.random()}@x.io`, name: role });
  await runWithTenant(t, () => db.repos.memberships.create({ userId: u._id, role }));
  return String(u._id);
}
async function mkTenant(slug: string, agentNumbers?: Record<string, string>, withVoice = true) {
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN' }));
  const id = String(t._id);
  await runWithTenant(id, async () => { await seedPreset(db.repos, 'generic'); });
  const agent = await mkUser(id);
  let conn: any;
  if (withVoice) conn = (await runWithTenant(id, () => new ConnectionService(db, keys, registry).create({ provider: 'fake-voice', name: 'Voice', config: { agentNumbers: agentNumbers ? JSON.stringify({ [agent]: agentNumbers.agent }) : undefined } }))) as any;
  return { id, agent, conn: conn?.connection ? await runWithTenant(id, () => db.repos.connections.findById(conn.connection.id)) as any : null };
}
const newLead = async (t: string, owner: string) => { const p = `98${String(++phone).padStart(8, "0")}`; return { id: ((await as(t, owner, () => leads.intake({ name: "Call Lead", contacts: [{ value: p }], ownerId: owner }))) as any).leadId as string, phone: `+91${p}` }; };
const ev = (callRef: string, state: any, extra: any = {}) => ({ kind: 'CallEvent' as const, callRef, state, ...extra });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('tel_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); keys = new LocalKeyService(randomBytes(32)); leads = new LeadService(db);
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('mode selection', () => {
  it('falls back to tap-to-call without a voice connection, or when the agent has no mapped number', async () => {
    const none = await mkTenant('novoice', undefined, false);
    const l1 = await newLead(none.id, none.agent);
    const r1 = await as(none.id, none.agent, () => svc().dial(l1.id));
    expect(r1).toMatchObject({ mode: 'tap', dialUri: l1.phone.replace(/^/, 'tel:') });
    const unmapped = await mkTenant('unmapped');
    const l2 = await newLead(unmapped.id, unmapped.agent);
    expect((await as(unmapped.id, unmapped.agent, () => svc().dial(l2.id))).mode).toBe('tap');
  });

  it('cloud mode: rings the mapped agent number, never exposes the lead number, blocks a second call until outcome', async () => {
    const T = await mkTenant('cloud', { agent: '+919900000001' });
    const l = await newLead(T.id, T.agent);
    started.length = 0;
    const r = await as(T.id, T.agent, () => svc().dial(l.id));
    expect(r.mode).toBe('cloud'); expect(r.dialUri).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain(l.phone.slice(3));
    expect(started[0]).toMatchObject({ agentNumber: '+919900000001', leadNumber: l.phone, record: true });
    const creds = await runWithTenant(T.id, () => new ConnectionService(db, keys, registry).credentials(T.conn));
    expect(started[0].callbackUrl).toBe(`https://ingress.test/hooks/fake-voice/${T.conn.publicId}?token=${encodeURIComponent(creds.webhookToken)}`);
    const s: any = await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId));
    expect(s).toMatchObject({ mode: 'cloud', state: 'ringing', providerCallId: 'call-1', durationSource: 'system' });
    await expect(as(T.id, T.agent, () => svc().dial(l.id))).rejects.toMatchObject({ code: 'outcome_pending' });
  });

  it('a provider failure frees the agent instead of blocking them behind a call that never happened', async () => {
    const T = await mkTenant('callfail', { agent: '+919900000002' });
    const l = await newLead(T.id, T.agent);
    failStart = true;
    await expect(as(T.id, T.agent, () => svc().dial(l.id))).rejects.toMatchObject({ code: 'call_failed', status: 502 });
    failStart = false;
    const r = await as(T.id, T.agent, () => svc().dial(l.id));
    expect(r.mode).toBe('cloud');
    const logs = (await as(T.id, T.agent, () => db.repos.integrationLogs.find({ connectionId: T.conn._id }))) as any[];
    expect(logs.some((x) => /Click-to-call failed: provider down/.test(x.message))).toBe(true);
  });
});

describe('provider callbacks', () => {
  it('answered -> ended records system-verified duration once, frees presence, emits call.ended; the outcome sheet then works', async () => {
    const T = await mkTenant('events', { agent: '+919900000003' });
    const l = await newLead(T.id, T.agent);
    const r = await as(T.id, T.agent, () => svc().dial(l.id));
    const id = ((await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).providerCallId;
    await as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'answered')));
    expect(((await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).state).toBe('answered');
    expect(await as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'ended', { durationS: 125, outcome: 'completed' })))).toEqual({ state: 'ended' });
    expect(await as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'ended', { durationS: 999 })))).toMatchObject({ duplicate: true });
    const s: any = await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId));
    expect(s).toMatchObject({ state: 'ended', durationS: 125, durationSource: 'system', providerOutcome: 'completed' });
    expect(await as(T.id, T.agent, () => db.repos.outbox.count({ type: 'call.ended', aggregateId: r.callSessionId }))).toBe(1);
    // still blocks until the agent logs an outcome, which stays attached to the system-verified call
    await expect(as(T.id, T.agent, () => svc().dial(l.id))).rejects.toMatchObject({ code: 'outcome_pending' });
    const outcome: any = await as(T.id, T.agent, () => db.repos.outcomes.findOne({ label: 'Wrong Number' }));
    await as(T.id, T.agent, () => new DoService(db).logOutcome({ leadId: l.id, outcomeId: String(outcome._id), callSessionId: r.callSessionId }));
    const after: any = await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId));
    expect(after).toMatchObject({ durationS: 125, durationSource: 'system' });
    expect((await as(T.id, T.agent, () => svc().dial(l.id))).mode).toBe('cloud'); // free again
  });

  it('busy / no-answer endings still ask for an outcome; unknown calls and other tenants are ignored', async () => {
    const A = await mkTenant('evA', { agent: '+919900000004' }); const B = await mkTenant('evB', { agent: '+919900000005' });
    const l = await newLead(A.id, A.agent);
    const r = await as(A.id, A.agent, () => svc().dial(l.id));
    const id = ((await as(A.id, A.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).providerCallId;
    expect(await as(B.id, B.agent, () => svc().handleEvent(B.conn, ev(id, 'ended', { outcome: 'busy' })))).toEqual({ unknown: true }); // same provider id, other tenant
    expect(((await as(A.id, A.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).state).toBe('ringing');
    expect(await as(A.id, A.agent, () => svc().handleEvent(A.conn, ev('nope', 'ended')))).toEqual({ unknown: true });
    await as(A.id, A.agent, () => svc().handleEvent(A.conn, ev(id, 'ended', { outcome: 'no_answer' })));
    const s: any = await as(A.id, A.agent, () => db.repos.callSessions.findById(r.callSessionId));
    expect(s).toMatchObject({ state: 'ended', durationS: 0, providerOutcome: 'no_answer' });
    const q = await as(A.id, A.agent, () => new DoService(db).queue(A.agent));
    expect(q.items[0]).toMatchObject({ kind: 'outcome_pending', callSessionId: r.callSessionId });
  });
});

describe('recordings', () => {
  it('are fetched into storage once, served only through short-lived signed URLs, and a failed download is retryable', async () => {
    const T = await mkTenant('rec', { agent: '+919900000006' });
    const l = await newLead(T.id, T.agent);
    const r = await as(T.id, T.agent, () => svc().dial(l.id));
    const id = ((await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).providerCallId;
    await expect(as(T.id, T.agent, () => svc().recordingUrl(r.callSessionId))).rejects.toMatchObject({ code: 'no_recording', status: 404 });
    failFetch = true;
    await expect(as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'recording_ready', { recordingUrl: 'https://s.exotel.com/r.mp3' })))).rejects.toThrow('download failed');
    expect(((await as(T.id, T.agent, () => db.repos.callSessions.findById(r.callSessionId))) as any).recordingObjectKey).toBeUndefined();
    failFetch = false;
    expect(await as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'recording_ready', { recordingUrl: 'https://s.exotel.com/r.mp3' })))).toEqual({ recorded: true });
    expect(await as(T.id, T.agent, () => svc().handleEvent(T.conn, ev(id, 'recording_ready', { recordingUrl: 'https://s.exotel.com/r.mp3' })))).toMatchObject({ duplicate: true });
    const { url, expiresInSeconds } = await as(T.id, T.agent, () => svc().recordingUrl(r.callSessionId));
    expect(expiresInSeconds).toBe(300); expect(url).toMatch(/^https:\/\/api\.test\/v1\/recordings\/.+\..+$/);
    expect(url).not.toContain(r.callSessionId); // the object key is not guessable from the URL
    const token = url.split('/v1/recordings/')[1];
    const got = await store.open(token);
    expect(got?.bytes.toString()).toBe('audio:https://s.exotel.com/r.mp3');
    // the call history never lists storage keys
    expect(JSON.stringify(await as(T.id, T.agent, () => svc().calls(l.id)))).not.toContain('recordings/');
  });
});

describe('FsObjectStore', () => {
  it('rejects tampered, expired and traversal tokens', async () => {
    let clock = Date.now();
    const s = new FsObjectStore(mkdtempSync(join(tmpdir(), 'ld-fs-')), 'another-secret-key-123', '', () => clock);
    await s.put('a/b/c.mp3', Buffer.from('xyz'), 'audio/mpeg');
    const url = await s.signedUrl('a/b/c.mp3', 60); const token = url.split('/v1/recordings/')[1];
    expect((await s.open(token))?.bytes.toString()).toBe('xyz');
    expect(await s.open(token.slice(0, -2) + 'xx')).toBeNull();
    expect(await s.open('garbage')).toBeNull();
    const forged = Buffer.from(JSON.stringify({ k: 'a/b/c.mp3', e: Math.floor(clock / 1000) + 99999 })).toString('base64url') + '.' + token.split('.')[1];
    expect(await s.open(forged)).toBeNull();
    clock += 61_000;
    expect(await s.open(token)).toBeNull();
    await expect(s.put('../escape.mp3', Buffer.from('x'), 'audio/mpeg')).rejects.toThrow(/Invalid object key/);
    expect(() => new FsObjectStore('/tmp/x', 'short')).toThrow();
  });
});
