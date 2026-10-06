import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { TenantDbRouter, createSystemOps, migrateUp, runAsSystem, runWithTenant } from '../src';
import { Types } from 'mongoose';

export async function startDb() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const url = rs.getUri('leaddesk_test');
  const client = await MongoClient.connect(url);
  await migrateUp(client.db());
  await client.close();
  const router = new TenantDbRouter(url, 'leaddesk_test');
  const db = await router.connect();
  const sys = createSystemOps(db.models);
  return {
    rs, router, db, sys, url,
    async stop() { await router.close(); await rs.stop(); },
  };
}

export const oid = () => new Types.ObjectId();

/** Two tenants with a lead + connection each. */
export async function seedTwoTenants(db: Awaited<ReturnType<typeof startDb>>['db']) {
  const out: Record<'A' | 'B', { tenantId: string; leadId: string; connectionId: string; phone: string }> = {} as any;
  for (const [k, phone] of [['A', '+919876543210'], ['B', '+919876500000']] as const) {
    const tenant = await runAsSystem('test', () => db.models.Tenant.create({ name: `Tenant ${k}`, slug: `t-${k.toLowerCase()}` }));
    const tenantId = String(tenant._id);
    await runWithTenant(tenantId, async () => {
      const lead = await db.repos.leads.createWithContacts({ displayName: `Lead ${k}`, contacts: [{ kind: 'phone', valueNorm: phone }] });
      const conn = await db.repos.connections.create({ provider: 'meta', category: 'lead_source', name: 'm', publicId: `pub-${k}`, secretCiphertext: Buffer.from('x') });
      out[k] = { tenantId, leadId: String(lead._id), connectionId: String(conn._id), phone };
    });
  }
  return out;
}
