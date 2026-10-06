import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, verifyDatabase } from '../src';

let rs: MongoMemoryReplSet; let client: MongoClient;
beforeAll(async () => { rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); client = await MongoClient.connect(rs.getUri()); });
afterAll(async () => { await client.close(); await rs.stop(); });

describe('restore verification', () => {
  it('a freshly migrated database verifies; an empty one reports missing migrations and indexes', async () => {
    const empty = await verifyDatabase(client.db('empty_db'));
    expect(empty.ok).toBe(false); expect(empty.problems.some((p) => p.startsWith('migration not applied'))).toBe(true); expect(empty.problems.some((p) => p.startsWith('missing index'))).toBe(true);
    await migrateUp(client.db('good_db'));
    expect(await verifyDatabase(client.db('good_db'))).toMatchObject({ ok: true, problems: [] });
  });
  it('catches a dropped index, a document without tenantId, and too few tenants', async () => {
    const db = client.db('bad_db'); await migrateUp(db);
    await db.collection('leads').dropIndex('tenantId_1_nameTokens_1');
    await db.collection('leads').insertOne({ displayName: 'orphan' }, { bypassDocumentValidation: true }); // the $jsonSchema validator normally refuses this: a restore could still smuggle one in
    await db.collection('tenants').insertOne({ name: 't' });
    const r = await verifyDatabase(db, { expectMinTenants: 2 });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([expect.stringContaining('missing index on leads'), '1 document(s) in leads have no tenantId', 'expected at least 2 tenants, found 1']));
  });
});
