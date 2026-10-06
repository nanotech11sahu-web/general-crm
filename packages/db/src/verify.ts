import type { Db } from 'mongodb';
import { GLOBAL_COLLECTIONS } from './models';
import { INDEXES, INDEXES_V2, INDEXES_V3, INDEXES_V4, INDEXES_V5, INDEXES_V6 } from './indexes';
import { MIGRATIONS } from './migrations';

export interface VerifyReport { ok: boolean; problems: string[]; counts: Record<string, number>; tenantsWithData: number }
const sameKeys = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

/**
 * Integrity check for a restored database (backup drill) or a fresh deploy: migrations recorded, every declared index present,
 * and no tenant-owned document without a tenantId (the isolation invariant). Read-only.
 */
export async function verifyDatabase(db: Db, o: { expectMinTenants?: number } = {}): Promise<VerifyReport> {
  const problems: string[] = []; const counts: Record<string, number> = {};
  const applied = new Set((await db.collection('changelog').find().toArray()).map((d: any) => d.fileName));
  for (const m of MIGRATIONS) if (!applied.has(m.id)) problems.push(`migration not applied: ${m.id}`);
  const have = new Map<string, any[]>();
  for (const i of [...INDEXES, ...INDEXES_V2, ...INDEXES_V3, ...INDEXES_V4, ...INDEXES_V5, ...INDEXES_V6]) {
    if (!have.has(i.collection)) have.set(i.collection, await db.collection(i.collection).indexes().catch(() => []));
    if (!have.get(i.collection)!.some((x: any) => sameKeys(x.key, i.keys))) problems.push(`missing index on ${i.collection}: ${JSON.stringify(i.keys)}`);
  }
  const global = new Set<string>(GLOBAL_COLLECTIONS);
  for (const name of [...new Set([...INDEXES, ...INDEXES_V3, ...INDEXES_V4, ...INDEXES_V5, ...INDEXES_V6].map((i) => i.collection))]) {
    counts[name] = await db.collection(name).estimatedDocumentCount();
    if (!global.has(name)) { const orphan = await db.collection(name).countDocuments({ tenantId: { $exists: false } }); if (orphan) problems.push(`${orphan} document(s) in ${name} have no tenantId`); }
  }
  counts.tenants = await db.collection('tenants').countDocuments({}); counts.users = await db.collection('users').countDocuments({});
  const tenantsWithData = (await db.collection('memberships').distinct('tenantId')).length;
  if (o.expectMinTenants !== undefined && counts.tenants < o.expectMinTenants) problems.push(`expected at least ${o.expectMinTenants} tenants, found ${counts.tenants}`);
  return { ok: problems.length === 0, problems, counts, tenantsWithData };
}
