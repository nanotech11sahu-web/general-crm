import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter, createSystemOps } from '@leaddesk/db';
import { OpsService } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any;
const NOW = new Date('2026-03-10T06:30:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
const svc = () => new OpsService(db, () => NOW);
const mkTenant = async (slug: string) => String(((await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug }))) as any)._id);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('ops_test'); const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect();
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('tenant health and alert rules', () => {
  it('a quiet healthy workspace has no alerts', async () => {
    const T = await mkTenant('quiet');
    const h: any = await as(T, () => svc().tenantHealth());
    expect(h).toMatchObject({ webhooks: { pending: 0, dead: 0, oldestPendingS: 0 }, sends: { last24h: 0, failureRate: 0 }, timers: { claimTimersOverdue: 0, tasksNotSwept: 0 }, outbox: { backlog: 0 } });
    expect(svc().alertsFrom(h)).toEqual([]);
  });

  it('detects ingest lag, dead letters, send failures, stuck timers, outbox backlog and unhealthy connections; notifies admins once per hour', async () => {
    const T = await mkTenant('sick');
    await as(T, async () => {
      const R = db.repos;
      const conn: any = await R.connections.create({ provider: 'meta-leadads', category: 'lead_source', name: 'Meta Ads', publicId: 'p1', status: 'failing', lastError: 'token expired' });
      await R.connections.create({ provider: 'website-webhook', category: 'lead_source', name: 'Site', publicId: 'p2', status: 'verified' });
      const row = (status: string, s: number, extra: any = {}) => R.inbox.create({ connectionId: conn._id, provider: 'meta-leadads', externalEventId: `e-${Math.random()}`, signatureValid: true, status, receivedAt: ago(s), ...extra });
      await row('received', 1500); await row('failed', 600); await row('dead', 7200); await row('done', 100, { processedAt: ago(98) }); await row('done', 100, { processedAt: ago(90) });
      const lead: any = await R.leads.create({ displayName: 'L', nameTokens: ['l'], contacts: [], sla: { state: 'awaiting_claim', claimDueAt: ago(900) } });
      await R.tasks.create({ leadId: lead._id, assigneeId: '65f000000000000000000001', dueAt: ago(3 * 3600), contextNote: 'Call back about visit', status: 'open' });
      const cv: any = await R.conversations.create({ leadId: lead._id, channel: 'sms', connectionId: conn._id });
      for (let i = 0; i < 12; i++) await R.messages.create({ conversationId: cv._id, leadId: lead._id, direction: 'out', channel: 'sms', body: 'x', status: i < 5 ? 'failed' : 'sent', source: 'agent', idempotencyKey: `k${i}`, createdAt: ago(3600) });
      await R.outbox.create({ type: 'x', payload: {}, createdAt: ago(1800) });
    });
    const h: any = await as(T, () => svc().tenantHealth());
    expect(h.webhooks).toMatchObject({ pending: 2, failed: 1, dead: 1, deadLast24h: 1, oldestPendingS: 1500 });
    expect(h.webhooks.processingLatencyS).toMatchObject({ samples: 2, p50: expect.any(Number) });
    expect(h.sends).toMatchObject({ last24h: 12, failed: 5 }); expect(h.sends.failureRate).toBeCloseTo(0.417, 2);
    expect(h.timers).toMatchObject({ claimTimersOverdue: 1, tasksNotSwept: 1 }); expect(h.outbox).toMatchObject({ backlog: 1, oldestS: 1800 });
    expect(h.connections.unhealthy).toEqual([expect.objectContaining({ name: 'Meta Ads', status: 'failing', lastError: 'token expired' })]);
    const rules = svc().alertsFrom(h).map((a) => a.rule).sort();
    expect(rules).toEqual(['connection_unhealthy', 'dlq', 'ingest_lag', 'outbox_backlog', 'send_failures', 'sla_timer_lag']);
    expect(svc().alertsFrom(h).find((a) => a.rule === 'ingest_lag')!.severity).toBe('critical'); // 25 min > 4x the 5 min threshold
    expect(svc().alertsFrom(h).find((a) => a.rule === 'sla_timer_lag')!.severity).toBe('critical');

    await as(T, () => svc().evaluate()); await as(T, () => svc().evaluate()); // same hour: deduped
    const notes: any[] = await as(T, () => db.repos.notifications.find({ kind: /^ops\.alert\./ }));
    expect(notes).toHaveLength(6); expect(notes.every((n) => n.audience === 'admins')).toBe(true);
    const later = new OpsService(db, () => new Date(NOW.getTime() + 3600_000));
    await as(T, () => later.evaluate());
    expect(await as(T, () => db.repos.notifications.count({ kind: /^ops\.alert\./ }))).toBeGreaterThan(6); // the next hour nudges again
  });

  it('tenants are isolated and the sweeper visits each one', async () => {
    const A = await mkTenant('iso-a'); const B = await mkTenant('iso-b');
    await as(A, () => db.repos.connections.create({ provider: 'x', category: 'lead_source', name: 'Broken', publicId: 'pa', status: 'revoked' }));
    expect((await as(B, () => svc().tenantHealth()) as any).connections.total).toBe(0);
    const sys = createSystemOps(db.models);
    const r = await OpsService.sweepAll(db, sys, () => NOW);
    expect(r.alerts).toBeGreaterThanOrEqual(1);
    expect(await as(B, () => db.repos.notifications.count({ kind: /^ops\.alert\./ }))).toBe(0);
  });

  it('platformStats gives counts and ages for /metrics without tenant data', async () => {
    const s: any = await createSystemOps(db.models).platformStats(NOW);
    expect(s).toMatchObject({ inboxDead: expect.any(Number), tenants: expect.any(Number) });
    expect(s.oldestPendingInboxS).toBeGreaterThan(0); expect(s.slaClaimsOverdue).toBeGreaterThanOrEqual(1); expect(s.connections).toHaveProperty('failing');
    expect(JSON.stringify(s)).not.toMatch(/displayName|contacts/);
  });
});
