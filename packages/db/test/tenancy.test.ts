import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { CrossTenantError, TenantContextError, runAsSystem, runWithTenant, runTenantJob, withTransaction } from '../src';
import { seedTwoTenants, startDb } from './helpers';

let env: Awaited<ReturnType<typeof startDb>>;
let seed: Awaited<ReturnType<typeof seedTwoTenants>>;
beforeAll(async () => { env = await startDb(); seed = await seedTwoTenants(env.db); });
afterAll(async () => { await env.stop(); });

const as = <T>(k: 'A' | 'B', fn: () => T) => runWithTenant(seed[k].tenantId, fn);

describe('no tenant context => everything throws', () => {
  it('repository reads/writes', async () => {
    const { repos } = env.db;
    expect(() => repos.leads.find()).toThrow(TenantContextError);
    await expect(repos.leads.create({ displayName: 'x' })).rejects.toThrow(TenantContextError);
    expect(() => repos.leads.aggregate([])).toThrow(TenantContextError);
  });
  it('raw model queries are blocked by the plugin', async () => {
    const { Lead } = env.db.models;
    await expect(Lead.find({}).exec()).rejects.toThrow(TenantContextError);
    await expect(Lead.findOne({}).exec()).rejects.toThrow(TenantContextError);
    await expect(Lead.countDocuments({}).exec()).rejects.toThrow(TenantContextError);
    await expect(Lead.updateMany({}, { $set: { displayName: 'z' } }).exec()).rejects.toThrow(TenantContextError);
    await expect(Lead.deleteMany({}).exec()).rejects.toThrow(TenantContextError);
    await expect(Lead.aggregate([{ $match: {} }]).exec()).rejects.toThrow(TenantContextError);
    await expect(new Lead({ displayName: 'x' }).save()).rejects.toThrow(TenantContextError);
    await expect(Lead.insertMany([{ displayName: 'x' }])).rejects.toThrow(TenantContextError);
  });
  it('system context must be a named operation', () => {
    expect(() => runAsSystem('bogus' as any, () => 1)).toThrow();
  });
});

describe('cross-tenant matrix', () => {
  it('reads only see own data', async () => {
    const a = await as('A', () => env.db.repos.leads.find());
    const b = await as('B', () => env.db.repos.leads.find());
    expect(a.map((l: any) => String(l._id))).toEqual([seed.A.leadId]);
    expect(b.map((l: any) => String(l._id))).toEqual([seed.B.leadId]);
  });
  it("A cannot fetch B's lead by id", async () => {
    expect(await as('A', () => env.db.repos.leads.findById(seed.B.leadId))).toBeNull();
  });
  it('spoofed tenantId in a filter is rejected (repo and raw model)', async () => {
    await expect(as('A', async () => env.db.repos.leads.find({ tenantId: seed.B.tenantId }))).rejects.toThrow();
    await expect(as('A', () => env.db.models.Lead.find({ tenantId: new Types.ObjectId(seed.B.tenantId) }).exec())).rejects.toThrow(CrossTenantError);
  });
  it('$or cannot escape the tenant scope', async () => {
    const r = await as('A', () => env.db.models.Lead.find({ $or: [{ _id: seed.B.leadId }, { displayName: 'Lead B' }] }).lean().exec());
    expect(r).toHaveLength(0);
  });
  it('update/delete cannot touch other tenant rows', async () => {
    const u = await as('A', () => env.db.repos.leads.updateOne({ _id: seed.B.leadId }, { $set: { displayName: 'hacked' } }));
    expect(u.matchedCount).toBe(0);
    const d = await as('A', () => env.db.repos.leads.deleteOne({ _id: seed.B.leadId }));
    expect(d.deletedCount).toBe(0);
    const raw = await as('A', () => env.db.models.Lead.updateMany({}, { $set: { displayName: 'hacked' } }).exec());
    expect(raw.matchedCount).toBe(1);
    const still = await as('B', () => env.db.repos.leads.findById(seed.B.leadId));
    expect((still as any).displayName).toBe('Lead B');
    await as('A', () => env.db.repos.leads.updateOne({ _id: seed.A.leadId }, { $set: { displayName: 'Lead A' } }));
  });
  it('tenantId is immutable', async () => {
    await expect(as('A', () => env.db.models.Lead.updateOne({ _id: seed.A.leadId }, { $set: { tenantId: new Types.ObjectId(seed.B.tenantId) } }).exec())).rejects.toThrow(CrossTenantError);
    await expect(as('A', () => env.db.models.Lead.updateOne({ _id: seed.A.leadId }, { $unset: { tenantId: 1 } }).exec())).rejects.toThrow(CrossTenantError);
  });
  it('cannot create rows for another tenant', async () => {
    await expect(as('A', () => env.db.models.Lead.create({ displayName: 'x', tenantId: new Types.ObjectId(seed.B.tenantId) }))).rejects.toThrow(CrossTenantError);
    await expect(as('A', () => env.db.models.Lead.insertMany([{ displayName: 'x', tenantId: new Types.ObjectId(seed.B.tenantId) }]))).rejects.toThrow(CrossTenantError);
  });
  it('aggregates are force-scoped', async () => {
    const raw = await as('A', () => env.db.models.Lead.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]).exec());
    expect(raw[0].n).toBe(1);
    const viaRepo = await as('B', () => env.db.repos.leads.aggregate([{ $group: { _id: null, n: { $sum: 1 } } }]));
    expect(viaRepo[0].n).toBe(1);
  });
  it('unscoped $lookup is blocked; scoped pipeline-form $lookup works', async () => {
    const bad = as('A', () => env.db.models.Lead.aggregate([{ $lookup: { from: 'integrationconnections', localField: 'tenantId', foreignField: 'tenantId', as: 'c' } }]).exec());
    await expect(bad).rejects.toThrow(CrossTenantError);
    const ok = await as('A', () => env.db.models.Lead.aggregate([
      { $lookup: { from: 'integrationconnections', pipeline: [{ $match: { tenantId: new Types.ObjectId(seed.A.tenantId) } }], as: 'c' } },
    ]).exec());
    expect(ok[0].c).toHaveLength(1);
  });
  it('connections: listSafe never returns secret material and stays in tenant', async () => {
    const rows: any[] = await as('A', () => env.db.repos.connections.listSafe());
    expect(rows).toHaveLength(1);
    expect(rows[0].secretCiphertext).toBeUndefined();
    expect(rows[0].secretWrappedDek).toBeUndefined();
  });
  it('same phone allowed in two tenants, duplicate in same tenant rejected', async () => {
    await as('B', () => withTransaction(env.db.conn, async () => {
      await env.db.repos.leads.createWithContacts({ displayName: 'Other', contacts: [{ kind: 'phone', valueNorm: seed.A.phone }] });
    }));
    await expect(as('A', () => withTransaction(env.db.conn, async () => {
      await env.db.repos.leads.createWithContacts({ displayName: 'Dup', contacts: [{ kind: 'phone', valueNorm: seed.A.phone }] });
    }))).rejects.toThrow(/duplicate key|E11000/);
    const names = (await as('A', () => env.db.repos.leads.find())).map((l: any) => l.displayName);
    expect(names).not.toContain('Dup'); // transaction rolled back, no orphan lead
  });
  it('webhook ingress resolves a connection to its tenant via a named system op', async () => {
    const c: any = await env.sys.resolveConnection('pub-B');
    expect(String(c.tenantId)).toBe(seed.B.tenantId);
  });
});

describe('transactions & outbox', () => {
  it('lead + index + outbox commit atomically; failure rolls all back', async () => {
    const before = await as('A', () => env.db.repos.outbox.count());
    await expect(as('A', () => withTransaction(env.db.conn, async () => {
      const lead = await env.db.repos.leads.createWithContacts({ displayName: 'T1', contacts: [{ kind: 'phone', valueNorm: '+911111111111' }] });
      await env.db.repos.outbox.add('lead.created', String(lead._id));
      throw new Error('boom');
    }))).rejects.toThrow('boom');
    expect(await as('A', () => env.db.repos.outbox.count())).toBe(before);
    expect(await as('A', () => env.db.repos.leads.findDuplicate('phone', '+911111111111'))).toBeNull();

    await as('A', () => withTransaction(env.db.conn, async () => {
      const lead = await env.db.repos.leads.createWithContacts({ displayName: 'T2', contacts: [{ kind: 'phone', valueNorm: '+912222222222' }] });
      await env.db.repos.outbox.add('lead.created', String(lead._id));
    }));
    expect(await as('A', () => env.db.repos.outbox.count())).toBe(before + 1);
  });
  it('dispatcher leases events across tenants once, then marks dispatched', async () => {
    const claimed = await env.sys.claimEvents(50);
    expect(claimed.length).toBeGreaterThan(0);
    expect(await env.sys.claimEvents(50)).toHaveLength(0); // leased
    for (const e of claimed) await env.sys.markDispatched(e._id);
  });
});

describe('workers', () => {
  it('rejects jobs without tenantId and sets context otherwise', async () => {
    await expect(runTenantJob({} as any, async () => 1)).rejects.toThrow(/missing tenantId/);
    const n = await runTenantJob({ tenantId: seed.A.tenantId }, () => env.db.repos.leads.count());
    expect(n).toBeGreaterThan(0);
  });
});
