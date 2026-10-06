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
  const mkRow = (t: string, extra: any = {}) => runWithTenant(t, () => db.repos.inbox.create({
    connectionId: db.models.IntegrationInbox.base.Types.ObjectId.createFromTime(1), provider: 'website-webhook',
    externalEventId: 'e' + Math.random(), rawPayload: { id: 'L1' }, signatureValid: true, ...extra }));

  it('parses, marks done, is idempotent', async () => {
    const p = new InboxProcessor(db, defaultRegistry());
    const row: any = await mkRow(A);
    const job = { name: 'inbox.process', data: { tenantId: A, inboxId: String(row._id) }, attemptsMade: 0 };
    expect(await p.process(job)).toEqual({ events: 1 });
    expect(((await runWithTenant(A, () => db.repos.inbox.findById(row._id))) as any).status).toBe('done');
    expect(await p.process(job)).toEqual({ events: 0 });
  });
  it("tenant B's job cannot process tenant A's row", async () => {
    const p = new InboxProcessor(db, defaultRegistry());
    const row: any = await mkRow(A);
    await expect(p.process({ name: 'x', data: { tenantId: B, inboxId: String(row._id) }, attemptsMade: 0 })).rejects.toThrow('inbox row not found');
  });
  it('rejects jobs with no tenantId', async () => {
    await expect(new InboxProcessor(db, defaultRegistry()).process({ name: 'x', data: { inboxId: 'x' } as any, attemptsMade: 0 })).rejects.toThrow(/missing tenantId/);
  });
  it('failed parse retries then goes dead', async () => {
    const p = new InboxProcessor(db, defaultRegistry(), 2);
    const row: any = await mkRow(A, { provider: 'unknown-provider' });
    const job = { name: 'x', data: { tenantId: A, inboxId: String(row._id) }, attemptsMade: 0 };
    await expect(p.process(job)).rejects.toThrow();
    expect(((await runWithTenant(A, () => db.repos.inbox.findById(row._id))) as any).status).toBe('failed');
    await expect(p.process(job)).rejects.toThrow();
    expect(((await runWithTenant(A, () => db.repos.inbox.findById(row._id))) as any).status).toBe('dead');
  });
});

describe('OutboxDispatcher', () => {
  it('publishes each committed event once with its tenantId; rolled-back events never appear; failed publish is retried after lease', async () => {
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
    await runWithTenant(A, () => seedPreset(db.repos, 'generic'));
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
    expect(await runWithTenant(A, () => db.repos.leads.count())).toBe(2);
  });
});
