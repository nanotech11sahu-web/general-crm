import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { ConnectionService, DemoDataService, DoService, LeadService, MessagingService, PulseService, seedPreset, TelephonyService } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any;
const ME = '65f000000000000000000001';
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: ME });
const fakeSms: Connector = { manifest: { id: 'fake-sms', category: 'sms', displayName: 'x', logo: '', docsUrl: '', auth: { type: 'api_key' }, capabilities: ['msg.send'], credentialFields: [{ key: 'token', label: 't', type: 'secret', required: true }], configFields: [] }, async verify() { return { ok: true }; }, async health() { return { ok: true }; }, async send() { return { providerMessageId: 'pm' }; } };
async function mkTenant(slug: string, preset = 'real_estate') { const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug })); const id = String(t._id); await as(id, async () => { await seedPreset(db.repos, preset); await db.repos.memberships.create({ userId: ME, role: 'owner', status: 'active' }); }); return id; }

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('demo_test'); const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect();
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('sample data', () => {
  it('loads a believable workspace once: leads across every stage, tasks (some overdue), calls; Today and Pulse come alive', async () => {
    const T = await mkTenant('d1');
    const r = await as(T, () => new DemoDataService(db).load()); expect(r.leads).toBe(24);
    await expect(as(T, () => new DemoDataService(db).load())).rejects.toMatchObject({ code: 'demo_exists', status: 409 });
    const leads: any[] = await as(T, () => db.repos.leads.find({})); expect(leads).toHaveLength(24); expect(leads.every((l) => l.tags.includes('demo') && String(l.ownerId) === ME)).toBe(true);
    expect(leads.every((l) => l.contacts[0].valueNorm.startsWith('+9199999'))).toBe(true); // obviously fictional
    const q: any = await as(T, () => new DoService(db).queue(ME));
    expect(q.counts.new_lead).toBe(8); expect(q.total).toBeGreaterThan(10); expect(Object.keys(q.counts).length).toBeGreaterThanOrEqual(3); // new leads plus overdue/due follow-ups
    const k: any = await as(T, () => new PulseService(db).kpis('30d')); expect(k.counts.leads).toBe(24); expect(k.counts.calls).toBeGreaterThan(5); expect(k.metrics.conversionPct).toBeGreaterThan(0);
    const src: any = await as(T, () => new PulseService(db).sources({ range: '30d' })); expect(src.rows.map((x: any) => x.name).sort()).toEqual(['Facebook ads (sample)', 'Google Sheet (sample)', 'Website form (sample)']);
  });

  it('sample leads can never be messaged or called, even with channels connected', async () => {
    const T = await mkTenant('d2'); const keys = new LocalKeyService(randomBytes(32)); const reg = new ConnectorRegistry().register(fakeSms);
    await as(T, () => new ConnectionService(db, keys, reg).create({ provider: 'fake-sms', name: 'SMS', credentials: { token: 'tok-12345678' } }));
    await as(T, () => new DemoDataService(db).load());
    const id = String(((await as(T, () => db.repos.leads.findOne({}))) as any)._id);
    await expect(as(T, () => new MessagingService(db, keys, reg).send({ leadId: id, channel: 'sms', body: 'hi', idempotencyKey: 'demo-send-0001' }))).rejects.toMatchObject({ code: 'demo_lead' });
    await expect(as(T, () => new TelephonyService(db, keys, reg, { put: async () => undefined, signedUrl: async () => '', delete: async () => undefined, deletePrefix: async () => undefined }).dial(id))).rejects.toMatchObject({ code: 'demo_lead' });
    expect(await as(T, () => db.repos.enrollments.count({}))).toBe(0); // no first-touch automation for sample leads
  });

  it('clear removes the sample leads and everything attached, leaves real leads alone, and the sample can be loaded again', async () => {
    const T = await mkTenant('d3'); await as(T, () => new DemoDataService(db).load());
    const real: any = await as(T, () => new LeadService(db).intake({ name: 'Real Customer', contacts: [{ value: '9812300999' }] }));
    const r = await as(T, () => new DemoDataService(db).clear()); expect(r.removed).toBe(24);
    await as(T, async () => {
      expect(await db.repos.leads.count({})).toBe(1); expect(await db.repos.leads.findById(real.leadId)).toBeTruthy();
      expect(await db.repos.tasks.count({})).toBe(0); expect(await db.repos.callSessions.count({})).toBe(0); expect(await db.repos.suppressions.count({})).toBe(0); // no suppression for fictional numbers
      expect(await db.repos.sources.count({ name: /\(sample\)$/ })).toBe(0);
    });
    expect(await as(T, () => new DemoDataService(db).status())).toEqual({ loaded: false, leads: 0 });
    expect((await as(T, () => new DemoDataService(db).load())).leads).toBe(24);
  });

  it('other workspaces are untouched', async () => {
    const A = await mkTenant('d4a'); const B = await mkTenant('d4b'); await as(A, () => new DemoDataService(db).load());
    expect(await as(B, () => db.repos.leads.count({}))).toBe(0); await as(B, () => new DemoDataService(db).load()); await as(A, () => new DemoDataService(db).clear());
    expect(await as(B, () => db.repos.leads.count({}))).toBe(24);
  });
});
