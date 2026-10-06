import type { Db } from 'mongodb';
import { createIndexes, INDEXES_V6 } from '../indexes';

export const id = '20251001000001-invoices';

/** Phase 9d: tax invoices and their gapless per-financial-year sequence. */
export async function up(db: Db) {
  for (const c of ['invoices', 'invoicesequences']) if (!(await db.listCollections({ name: c }).toArray()).length) await db.createCollection(c);
  await createIndexes(db, INDEXES_V6);
}
export async function down(db: Db) { for (const i of INDEXES_V6) await db.collection(i.collection).dropIndex(i.options!.name as string).catch(() => undefined); }
