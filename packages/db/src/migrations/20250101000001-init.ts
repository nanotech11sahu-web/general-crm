import type { Db } from 'mongodb';
import { createIndexes, ensureCollections, INDEXES } from '../indexes';
import { applyValidators, removeValidators } from '../validators';

export const id = '20250101000001-init';

export async function up(db: Db) {
  await ensureCollections(db);
  await createIndexes(db);
  await applyValidators(db);
}

/** Reversible: drops the indexes this migration created and removes validators (collections are kept). */
export async function down(db: Db) {
  await removeValidators(db);
  for (const i of INDEXES) {
    const name = Object.entries(i.keys).map(([k, v]) => `${k}_${v}`).join('_');
    await db.collection(i.collection).dropIndex(name).catch(() => undefined);
  }
}
