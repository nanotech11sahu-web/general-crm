import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthRevokedError, ConnectorRegistry, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { businessMinutes, ConnectionService, detectSilence, IntegrityService, planSweep, seedPreset } from '../src';

const HOUR = 3_600_000, DAY = 86_400_000;
const TZ = 'Asia/Kolkata';
// a fixed Tuesday 12:00 IST = 06:30 UTC
const NOW = new Date('2026-03-10T06:30:00Z');

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let keys: LocalKeyService; let T: string; let T2: string;
// a controllable fake provider
const beh = { health: { ok: true } as any, subscribed: { ok: true } as any, refreshFail: false, revoked: false, backfill: [] as any[], refreshCalls: 0 };
const fake: Connector = {
  manifest: { id: 'fake', category: 'lead_source', displayName: 'Fake', logo: '', docsUrl: '', auth: { type: 'oauth2' }, capabilities: ['lead.subscribe', 'lead.backfill'],
    credentialFields: [{ key: 'token', label: 'Token', type: 'secret', required: true }], configFields: [] },
  async verify() { return { ok: true }; },
  async health() { if (beh.revoked) throw new AuthRevokedError('token revoked'); return beh.health; },
  async ensureSubscribed() { return beh.subscribed; },
  async refresh() { beh.refreshCalls++; if (beh.refreshFail) throw new Error('graph 500'); return { credentials: { token: 'refreshed-token-9999' }, expiresAt: new Date(NOW.getTime() + 60 * DAY) }; },
  async parseWebhook(raw: any) { return [{ kind: 'LeadReceived', externalRef: String(raw.id), fields: raw }]; },
  async *backfill() { for (const l of beh.backfill) yield l; },
};
const registry = new ConnectorRegistry().register(fake);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
const notes: any[] = [];
const notifier = { notify: async (n: any) => { notes.push(n); } };
const svc = () => new IntegrityService(db, keys, registry, notifier, () => NOW);

async function mkConn(t: string, extra: any = {}) {
  const conns = new ConnectionService(db, keys, registry);
  const out: any = await as(t, () => conns.create({ provider: 'fake', name: 'Fake src', credentials: { token: 'initial-token-1234' } }));
  const id = out.connection.id;
  if (Object.keys(extra).length) await as(t, () => db.repos.connections.updateOne({ _id: id }, { $set: extra }));
  return id as string;
}
const status = async (t: string, id: string) => ((await as(t, () => db.repos.connections.findById(id))) as any).status;
const seedEvents = (t: string, id: string, times: Date[]) => as(t, () => db.repos.inbox.createMany(times.map((d, i) => ({ connectionId: id, provider: 'fake', externalEventId: `seed-${id}-${i}`, rawPayload: {}, signatureValid: true, status: 'done', receivedAt: d }))));

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('integrity_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); keys = new LocalKeyService(randomBytes(32));
  const mk = async (slug: string) => {
    const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN', timezone: TZ }));
    await runWithTenant(String(t._id), () => seedPreset(db.repos, 'generic'));
    return String(t._id);
  };
  T = await mk('t1'); T2 = await mk('t2');
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('business time and silence math', () => {
  it('counts only 09:00-21:00 local time', () => {
    // Tue 20:00 IST -> Wed 10:00 IST = 1h (20-21) + 1h (9-10) = 120 min
    expect(businessMinutes(new Date('2026-03-10T14:30:00Z'), new Date('2026-03-11T04:30:00Z'), TZ)).toBe(120);
    expect(businessMinutes(new Date('2026-03-10T16:00:00Z'), new Date('2026-03-10T20:00:00Z'), TZ)).toBe(0); // night
  });
  it('needs a baseline; learns the typical gap; alerts after max(3x, 2h)', () => {
    const noBaseline = detectSilence([new Date(NOW.getTime() - 3 * DAY)], NOW, TZ);
    expect(noBaseline.silent).toBe(false);
    // a lead every 30 business-minutes for the last business day... threshold floors at 120 min
    const base = Array.from({ length: 20 }, (_, i) => new Date(NOW.getTime() - (20 - i) * 30 * 60_000 - 5 * HOUR));
    expect(detectSilence(base, NOW, TZ).thresholdMin).toBe(120);
    expect(detectSilence([...base, new Date(NOW.getTime() - 30 * 60_000)], NOW, TZ).silent).toBe(false);
    expect(detectSilence(base, NOW, TZ).silent).toBe(true); // quiet for >2 business hours
    // a slow source (one lead / ~6 business hours) is not flagged after 7 hours
    const slow = Array.from({ length: 12 }, (_, i) => new Date(NOW.getTime() - (12 - i) * 6 * HOUR * 1.0 - 2 * DAY));
    expect(detectSilence(slow, new Date(slow[11].getTime() + 7 * HOUR), TZ).silent).toBe(false);
  });
});

describe('state machine', () => {
  it('healthy -> verified, no notification', async () => {
    notes.length = 0; Object.assign(beh, { health: { ok: true }, subscribed: { ok: true }, revoked: false });
    const id = await mkConn(T);
    const r = await as(T, () => svc().heartbeat(id));
    expect(r).toMatchObject({ status: 'verified', changed: false });
    expect(notes).toHaveLength(0);
  });
  it('health failure => degraded + admin notification with reconnect link; recovery => verified; 3 failures => failing', async () => {
    notes.length = 0;
    const id = await mkConn(T);
    beh.health = { ok: false, detail: 'timeout' };
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('degraded');
    expect(notes.at(-1)).toMatchObject({ kind: 'connection.degraded', audience: 'admins' });
    expect(notes.at(-1).payload.reconnectPath).toBe(`/v1/connections/${id}/reconnect`);
    beh.health = { ok: true };
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('verified');
    beh.health = { ok: false, detail: 'down' };
    for (let i = 0; i < 3; i++) await as(T, () => svc().heartbeat(id));
    expect(await status(T, id)).toBe('failing');
    beh.health = { ok: true };
    expect(await status(T, id)).toBe('failing'); // stays until a clean heartbeat
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('verified');
  });
  it('provider revokes the grant => revoked; further heartbeats are no-ops', async () => {
    beh.revoked = true;
    const id = await mkConn(T);
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('revoked');
    beh.revoked = false;
    expect(await as(T, () => svc().heartbeat(id))).toMatchObject({ status: 'revoked', changed: false });
    const logs = (await as(T, () => db.repos.integrationLogs.find({ connectionId: id }))) as any[];
    expect(logs.some((l) => /verified -> revoked/.test(l.message))).toBe(true);
  });
  it('broken webhook subscription => degraded; auto re-subscribe is logged', async () => {
    Object.assign(beh, { health: { ok: true }, subscribed: { ok: false, detail: 'page 123 not subscribed' } });
    const id = await mkConn(T);
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('degraded');
    beh.subscribed = { ok: true, fixed: true, detail: 'resubscribed page 123' };
    const r = await as(T, () => svc().heartbeat(id));
    expect(r).toMatchObject({ status: 'verified', resubscribed: true });
  });
  it('silence on an established source => degraded; new source with no baseline is left alone', async () => {
    Object.assign(beh, { health: { ok: true }, subscribed: { ok: true } });
    const quiet = await mkConn(T);
    await seedEvents(T, quiet, Array.from({ length: 20 }, (_, i) => new Date(NOW.getTime() - 5 * HOUR - (20 - i) * 30 * 60_000)));
    const r = await as(T, () => svc().heartbeat(quiet));
    expect(r.status).toBe('degraded'); expect(r.reasons[0]).toMatch(/no leads for/);
    const fresh = await mkConn(T);
    expect((await as(T, () => svc().heartbeat(fresh))).status).toBe('verified');
  });
  it("tenant isolation: heartbeat cannot see another tenant's connection", async () => {
    const id = await mkConn(T);
    await expect(as(T2, () => svc().heartbeat(id))).rejects.toThrow('Connection not found');
  });
});

describe('token lifecycle', () => {
  it('refreshes at T-10d, stores the new encrypted token, and logs it', async () => {
    notes.length = 0; beh.refreshCalls = 0;
    const id = await mkConn(T, { oauthExpiresAt: new Date(NOW.getTime() + 9 * DAY) });
    const r = await as(T, () => svc().heartbeat(id));
    expect(r.refreshed).toBe(true); expect(beh.refreshCalls).toBe(1);
    const c: any = await as(T, () => db.repos.connections.findById(id));
    expect(new Date(c.oauthExpiresAt).getTime()).toBeGreaterThan(NOW.getTime() + 50 * DAY);
    expect(c.secretHint).toBe('••••9999');
    expect(notes.filter((n) => n.kind === 'connection.token_expiring')).toHaveLength(0);
    const conns = new ConnectionService(db, keys, registry);
    expect((await as(T, () => conns.credentials(c))).token).toBe('refreshed-token-9999');
    // far from expiry: no refresh
    const id2 = await mkConn(T, { oauthExpiresAt: new Date(NOW.getTime() + 40 * DAY) });
    await as(T, () => svc().heartbeat(id2)); expect(beh.refreshCalls).toBe(1);
  });
  it('refresh failing near expiry alerts at T-7/T-3/T-1 once each, and expiry => revoked', async () => {
    notes.length = 0; beh.refreshFail = true;
    const id = await mkConn(T, { oauthExpiresAt: new Date(NOW.getTime() + 2.5 * DAY) });
    await as(T, () => svc().heartbeat(id));
    const expiring = () => new Set((notes.filter((n) => n.kind === 'connection.token_expiring')).map((n) => n.dedupeKey));
    expect(expiring()).toEqual(new Set([`token:${id}:7`, `token:${id}:3`]));
    expect(await status(T, id)).toBe('degraded');
    await as(T, () => db.repos.connections.updateOne({ _id: id }, { $set: { oauthExpiresAt: new Date(NOW.getTime() - HOUR) } }));
    expect((await as(T, () => svc().heartbeat(id))).status).toBe('revoked');
    beh.refreshFail = false;
  });
});

describe('backfill reconcile', () => {
  it('ingests only leads we never received; idempotent on repeat; bad rows are counted not fatal', async () => {
    const id = await mkConn(T);
    await as(T, () => db.repos.inbox.create({ connectionId: id, provider: 'fake', externalEventId: 'L1', rawPayload: { id: 'L1', name: 'Have', phone: '9876510001' }, signatureValid: true, status: 'done', receivedAt: NOW }));
    beh.backfill = [
      { externalRef: 'L1', fields: { name: 'Have', phone: '9876510001' } },
      { externalRef: 'L2', fields: { name: 'Missed One', phone: '9876510002' } },
      { externalRef: 'L3', fields: { name: 'Missed Two', phone: '9876510003' } },
      { externalRef: 'L4', fields: { name: 'No Contact' } },
    ];
    const r = await as(T, () => svc().backfill(id, 2));
    expect(r).toEqual({ seen: 4, missing: 3, ingested: 2, failed: 1 });
    expect(await as(T, () => db.repos.leads.count({ displayName: { $in: ['Missed One', 'Missed Two'] } }))).toBe(2);
    expect(await as(T, () => db.repos.leads.count({ displayName: 'Have' }))).toBe(0); // L1 was already received; backfill never double-ingests
    const again = await as(T, () => svc().backfill(id, 2));
    expect(again).toEqual({ seen: 4, missing: 0, ingested: 0, failed: 0 }); // L4's failed row is already in Needs attention; nothing is re-added
  });
  it('revoked grant during backfill flips the connection to revoked', async () => {
    const id = await mkConn(T);
    const orig = fake.backfill; (fake as any).backfill = () => ({ [Symbol.asyncIterator]: () => ({ next: async () => { throw new AuthRevokedError('gone'); } }) });
    try { await as(T, () => svc().backfill(id, 14)); } finally { (fake as any).backfill = orig; }
    expect(await status(T, id)).toBe('revoked');
  });
});

describe('scheduler plan', () => {
  it('uses deterministic job ids per window so duplicate sweeps enqueue once', () => {
    const conns = [{ _id: 'c1', tenantId: 't1' }, { _id: 'c2', tenantId: 't2' }];
    const a = planSweep('heartbeat', conns, new Date('2026-03-10T06:31:00Z'));
    const b = planSweep('heartbeat', conns, new Date('2026-03-10T06:33:59Z'));
    expect(a.map((j) => j.jobId)).toEqual(b.map((j) => j.jobId));
    expect(planSweep('heartbeat', conns, new Date('2026-03-10T06:36:00Z'))[0].jobId).not.toBe(a[0].jobId);
    expect(planSweep('backfill_weekly', conns, NOW)[0]).toMatchObject({ name: 'integrity.backfill', data: { days: 80, tenantId: 't1' } });
    expect(planSweep('backfill_hourly', conns, NOW)[0].data.days).toBe(2);
    expect(planSweep('backfill_nightly', conns, NOW)[0].data.days).toBe(14);
  });
});
