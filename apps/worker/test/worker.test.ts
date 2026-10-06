import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultRegistry } from '@leaddesk/connectors-core';
import { createSystemOps, migrateUp, runAsSystem, runWithTenant, TenantDbRouter, withTransaction } from '@leaddesk/db';
import { InboxProcessor } from '../src/inbox.processor';
import { OutboxDispatcher } from '../src/outbox-dispatcher';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let sys: any; let A: string; let B: string;
beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('worker_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); sys = createSystemOps(db.models);
  const mk = async (slug: string) => String((await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug }))) ._id);
  A = await mk('a'); B = await mk('b');
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('InboxProcessor', () => {
  let connId: any;
  beforeAll(async () => {
    const { seedPreset } = await import('@leaddesk/domain');
    await runWithTenant(A, () => seedPreset(db.repos, 'generic'));
    connId = (await runWithTenant(A, () => db.repos.connections.create({ provider: 'website-webhook', category: 'lead_source', name: 'Site', publicId: 'wk-pub', status: 'verified' }))) ._id;
  });
  const mkRow = (t: string, extra: any = {}) => runWithTenant(t, () => db.repos.inbox.create({
    connectionId: connId, provider: 'website-webhook', externalEventId: 'e' + Math.random(), rawPayload: { id: 'L1', name: 'Wk', phone: '9876500001' }, signatureValid: true, ...extra }));
  const job = (t: string, row: any) => ({ name: 'inbox.process', data: { tenantId: t, inboxId: String(row._id) }, attemptsMade: 0 });
  const status = async (t: string, row: any) => ((await runWithTenant(t, () => db.repos.inbox.findById(row._id))) as any).status;

  it('turns a webhook into a lead via the intake pipeline; redelivery is idempotent', async () => {
    const p = new InboxProcessor(db, defaultRegistry());
    const row: any = await mkRow(A);
    expect(await p.process(job(A, row))).toEqual({ events: 1 });
    expect(await status(A, row)).toBe('done');
    expect(await runWithTenant(A, () => db.repos.leads.count({ displayName: 'Wk' }))).toBe(1);
    expect(await p.process(job(A, row))).toEqual({ events: 0 });
    expect(await runWithTenant(A, () => db.repos.leads.count({ displayName: 'Wk' }))).toBe(1);
    expect(((await runWithTenant(A, () => db.repos.connections.findById(connId))) as any).lastEventAt).toBeTruthy();
  });
  it("tenant B's job cannot process tenant A's row", async () => {
    const row: any = await mkRow(A);
    await expect(new InboxProcessor(db, defaultRegistry()).process(job(B, row))).rejects.toThrow('Inbox event not found');
    expect(await status(A, row)).toBe('received');
  });
  it('rejects jobs with no tenantId', async () => {
    await expect(new InboxProcessor(db, defaultRegistry()).process({ name: 'x', data: { inboxId: 'x' } as any, attemptsMade: 0 })).rejects.toThrow(/missing tenantId/);
  });
  it('unmappable payload is a non-retryable "failed" (needs attention), not a queue retry loop', async () => {
    const row: any = await mkRow(A, { rawPayload: { id: 'L9', nothing: 'useful' } });
    const out = await new InboxProcessor(db, defaultRegistry()).process(job(A, row)); // does not throw
    expect(out).toEqual({ events: 0 });
    expect(await status(A, row)).toBe('failed');
    expect(((await runWithTenant(A, () => db.repos.inbox.findById(row._id))) as any).error).toMatch(/rejected/i);
  });
  it('infrastructure errors throw for retry and end as dead after max attempts', async () => {
    const reg = defaultRegistry();
    const wh: any = reg.get('website-webhook'); const orig = wh.parseWebhook;
    wh.parseWebhook = async () => { throw new Error('provider 503'); };
    try {
      const p = new InboxProcessor(db, reg, undefined, 2);
      const row: any = await mkRow(A);
      await expect(p.process(job(A, row))).rejects.toThrow('provider 503');
      expect(await status(A, row)).toBe('failed');
      await expect(p.process(job(A, row))).rejects.toThrow('provider 503');
      expect(await status(A, row)).toBe('dead');
    } finally { wh.parseWebhook = orig; }
  });
});

describe('OutboxDispatcher', () => {
  it('publishes each committed event once with its tenantId; rolled-back events never appear; failed publish is retried after lease', async () => {
    for (const e of await sys.claimEvents(1000)) await sys.markDispatched(e._id); // drain events from earlier suites
    await runWithTenant(A, () => withTransaction(db.conn, () => db.repos.outbox.add('lead.created', '1')));
    await runWithTenant(B, () => withTransaction(db.conn, () => db.repos.outbox.add('lead.created', '2')));
    await expect(runWithTenant(A, () => withTransaction(db.conn, async () => { await db.repos.outbox.add('lead.created', 'ghost'); throw new Error('x'); }))).rejects.toThrow();
    const seen: any[] = [];
    let fail = true;
    const d = new OutboxDispatcher(sys, { publish: async (e) => { if (fail && e.aggregateId === '2') throw new Error('queue down'); seen.push(e); } });
    expect(await d.tick()).toBe(1);
    expect(seen.map((e) => e.aggregateId)).toEqual(['1']);
    expect(seen[0].tenantId).toBe(A);
    expect(await d.tick()).toBe(0); // event 2 is leased, not lost
    fail = false;
    await db.models.Event.collection.updateMany({ dispatchedAt: null }, { $set: { claimedUntil: new Date(0) } }); // lease expiry
    expect(await d.tick()).toBe(1);
    expect(seen.map((e) => e.aggregateId)).toEqual(['1', '2']);
    expect(await d.tick()).toBe(0);
  });
});

describe('ImportProcessor', () => {
  it('runs an import once; redelivery is a no-op; wrong tenant cannot run it', async () => {
    const { ImportProcessor } = await import('../src/import.processor');
    const { ImportService, seedPreset } = await import('@leaddesk/domain');
    void seedPreset; // tenant A is already seeded by the InboxProcessor suite
    const svc = new ImportService(db);
    const up: any = await runWithTenant(A, async () => {
      const u = await svc.create({ buffer: Buffer.from('Name,Phone\nW1,9700000001\nW2,9700000002'), originalname: 'w.csv' });
      await svc.setMapping(u.id, { Name: 'name', Phone: 'phone' });
      return u;
    });
    const p = new ImportProcessor(db);
    const job = { name: 'import.run', data: { tenantId: A, importId: up.id }, attemptsMade: 0 };
    expect(await p.process(job)).toMatchObject({ created: 2 });
    expect(await p.process(job)).toEqual({ skipped: true });
    expect(await p.process({ ...job, data: { tenantId: B, importId: up.id } })).toEqual({ skipped: true });
    expect(await runWithTenant(A, () => db.repos.leads.count({ displayName: { $in: ['W1', 'W2'] } }))).toBe(2);
  });
});

describe('integrity processor and scheduler', () => {
  it('heartbeat job runs under tenant context; unknown tenant cannot reach the connection', async () => {
    const { IntegrityProcessor } = await import('../src/integrity');
    const { LocalKeyService } = await import('@leaddesk/crypto');
    const { randomBytes } = await import('node:crypto');
    const { ConnectionService } = await import('@leaddesk/domain');
    const keys = new LocalKeyService(randomBytes(32));
    const reg = defaultRegistry();
    const created: any = await runWithTenant(A, () => new ConnectionService(db, keys, reg).create({ provider: 'website-webhook', name: 'HB' }));
    const p = new IntegrityProcessor(db, keys, reg);
    const data = { tenantId: A, connectionId: created.connection.id };
    expect(await p.process({ name: 'integrity.heartbeat', data, attemptsMade: 0 })).toMatchObject({ status: 'verified' });
    expect(await p.process({ name: 'integrity.backfill', data: { ...data, days: 2 }, attemptsMade: 0 })).toEqual({ seen: 0, missing: 0, ingested: 0, failed: 0 });
    await expect(p.process({ name: 'integrity.heartbeat', data: { ...data, tenantId: B }, attemptsMade: 0 })).rejects.toThrow('Connection not found');
    await expect(p.process({ name: 'integrity.heartbeat', data: { connectionId: data.connectionId } as any, attemptsMade: 0 })).rejects.toThrow(/missing tenantId/);
  });
  it('scheduler sweeps every live connection across tenants once per window and skips revoked ones', async () => {
    const { IntegrityScheduler } = await import('../src/integrity');
    const revoked: any = await runWithTenant(B, () => db.repos.connections.create({ provider: 'website-webhook', category: 'lead_source', name: 'Dead', publicId: 'dead-pub', status: 'revoked' }));
    await runWithTenant(B, () => db.repos.connections.create({ provider: 'website-webhook', category: 'lead_source', name: 'Live B', publicId: 'live-b', status: 'verified' }));
    const queued = new Map<string, any>();
    const sch = new IntegrityScheduler(sys, async (j) => { queued.set(j.jobId, j); }, () => new Date('2026-03-10T06:31:00Z'));
    const n1 = await sch.sweep('heartbeat'); const n2 = await sch.sweep('heartbeat');
    expect(n1).toBe(n2);
    expect(queued.size).toBe(n1); // second sweep in the same window produced identical job ids
    const tenants = new Set([...queued.values()].map((j) => j.data.tenantId));
    expect(tenants.has(A) && tenants.has(B)).toBe(true);
    expect([...queued.values()].some((j) => j.data.connectionId === String(revoked._id))).toBe(false);
  });
});

describe('DoSweeper', () => {
  it('marks overdue tasks missed across tenants and is idempotent', async () => {
    const { DoSweeper } = await import('../src/do-sweeper');
    const { runAsSystem } = await import('@leaddesk/db');
    const u: any = await db.models.User.create({ email: 'sweep@x.io', name: 'S' });
    await runWithTenant(A, () => db.repos.memberships.create({ userId: u._id, role: 'agent' }));
    const lead: any = await runWithTenant(A, () => db.repos.leads.createWithContacts({ displayName: 'Sweep', contacts: [{ kind: 'phone', valueNorm: '+919000099999' }] }));
    const task: any = await runWithTenant(A, () => db.repos.tasks.create({ leadId: lead._id, assigneeId: u._id, dueAt: new Date(Date.now() - 3600_000), contextNote: 'Call about sweep test', graceMinutes: 15, status: 'open' }));
    void runAsSystem;
    const sw = new DoSweeper(db, sys);
    expect((await sw.run()).missed).toBeGreaterThanOrEqual(1);
    expect(((await runWithTenant(A, () => db.repos.tasks.findById(task._id))) as any).status).toBe('missed');
    expect((await sw.run()).missed).toBe(0);
    expect(await runWithTenant(A, () => db.repos.notifications.count({ kind: 'task.missed' }))).toBe(2); // agent + managers
  });
});

describe('SlaSweeper', () => {
  it('runs the SLA sweep across tenants without error and is a no-op when nothing is due', async () => {
    const { SlaSweeper } = await import('../src/sla-sweeper');
    const r = await new SlaSweeper(db, sys, () => new Date(Date.now() - 86400_000)).run(); // clock in the past: nothing can be due
    expect(r).toEqual({ reassigned: 0, escalated: 0 });
  });
});

describe('CadenceSweeper', () => {
  it('is a no-op across tenants when nothing is due', async () => {
    const { CadenceSweeper } = await import('../src/cadence-sweeper');
    const { LocalKeyService } = await import('@leaddesk/crypto'); const { createRegistry } = await import('@leaddesk/connectors');
    const r = await new CadenceSweeper(db, sys, new LocalKeyService(Buffer.alloc(32, 1)), createRegistry({} as any), () => new Date(Date.now() - 86400_000)).run();
    expect(r).toMatchObject({ sent: 0, task: 0, stopped: 0 });
  });
});

describe('PulseSweeper', () => {
  it('runs across tenants and is a no-op before any tenant\'s digest hour', async () => {
    const { PulseSweeper } = await import('../src/pulse-sweeper');
    const r = await new PulseSweeper(db, sys, undefined, undefined, () => new Date('2026-03-10T00:30:00Z')).run(); // 06:00 IST: before 08:00
    expect(r).toEqual({ sent: 0 });
  });
});

describe('AiSweeper', () => {
  it('is a no-op across tenants when none has AI on', async () => {
    const { AiSweeper } = await import('../src/ai-sweeper');
    const { LocalKeyService } = await import('@leaddesk/crypto'); const { createRegistry } = await import('@leaddesk/connectors');
    expect(await new AiSweeper(db, sys, new LocalKeyService(Buffer.alloc(32, 1)), createRegistry({} as any)).run()).toEqual({ assessed: 0 });
  });
});

describe('billing sweep', () => {
  it('runs across tenants with nothing pending', async () => {
    const { BillingService } = await import('@leaddesk/domain');
    expect(await BillingService.sweepAll(db, sys, undefined, { reminders: true })).toMatchObject({ done: 0 });
  });
});
