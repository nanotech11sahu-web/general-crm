import type { Db } from 'mongodb';
import { MIGRATIONS } from './migrations';

/**
 * Minimal, idempotent runner (changelog collection) so migrations are testable
 * against a real replica set in CI. Compatible with migrate-mongo's changelog shape.
 */
export async function migrateUp(db: Db) {
  const log = db.collection('changelog');
  const applied = new Set((await log.find().toArray()).map((d: any) => d.fileName));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await m.up(db);
    await log.insertOne({ fileName: m.id, appliedAt: new Date() });
    ran.push(m.id);
  }
  return ran;
}

export async function migrateDown(db: Db) {
  const log = db.collection('changelog');
  const last = (await log.find().sort({ appliedAt: -1 }).limit(1).toArray())[0] as any;
  if (!last) return null;
  const m = MIGRATIONS.find((x) => x.id === last.fileName);
  if (!m) throw new Error(`Unknown migration ${last.fileName}`);
  await m.down(db);
  await log.deleteOne({ fileName: last.fileName });
  return last.fileName as string;
}
