import type { Db } from 'mongodb';
import { createIndexes, INDEXES_V4 } from '../indexes';

export const id = '20250801000001-email';

/** Phase 9: password reset links and the "not yet emailed" notification index. */
export async function up(db: Db) {
  if (!(await db.listCollections({ name: 'passwordresets' }).toArray()).length) await db.createCollection('passwordresets');
  await createIndexes(db, INDEXES_V4);
}
export async function down(db: Db) { for (const i of INDEXES_V4) await db.collection(i.collection).dropIndex(i.options!.name as string).catch(() => undefined); }
