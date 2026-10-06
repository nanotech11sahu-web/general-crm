import type { Db } from 'mongodb';
import { createIndexes, INDEXES_V2 } from '../indexes';

export const id = '20250601000001-indexes-v2';

/** Index audit follow-ups (see INDEXES_V2). Idempotent; builds online. */
export async function up(db: Db) { await createIndexes(db, INDEXES_V2); }
export async function down(db: Db) {
  for (const i of INDEXES_V2) await db.collection(i.collection).dropIndex(i.options!.name as string).catch(() => undefined);
}
