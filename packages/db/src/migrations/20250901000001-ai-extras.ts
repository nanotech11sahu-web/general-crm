import type { Db } from 'mongodb';
import { createIndexes, INDEXES_V5 } from '../indexes';

export const id = '20250901000001-ai-extras';

/** Phase 9c: knowledge base, suggestion lookups by type, call analysis queue. */
export async function up(db: Db) {
  if (!(await db.listCollections({ name: 'knowledgeentries' }).toArray()).length) await db.createCollection('knowledgeentries');
  await createIndexes(db, INDEXES_V5);
}
export async function down(db: Db) { for (const i of INDEXES_V5) await db.collection(i.collection).dropIndex(i.options!.name as string).catch(() => undefined); }
