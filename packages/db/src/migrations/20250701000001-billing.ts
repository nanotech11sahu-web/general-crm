import type { Db } from 'mongodb';
import { createIndexes, INDEXES_V3 } from '../indexes';

export const id = '20250701000001-billing';

/** Phase 8: subscriptions, billing events, platform audit. Existing workspaces get their trial lazily on first read (BillingService.current). */
export async function up(db: Db) {
  for (const c of ['subscriptions', 'billingevents', 'platformaudits']) if (!(await db.listCollections({ name: c }).toArray()).length) await db.createCollection(c);
  await createIndexes(db, INDEXES_V3);
}
export async function down(db: Db) { for (const i of INDEXES_V3) await db.collection(i.collection).dropIndex(i.options!.name as string).catch(() => undefined); }
