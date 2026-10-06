import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { INDEXES, migrateDown, migrateUp } from '../src';

let rs: MongoMemoryReplSet; let client: MongoClient;
beforeAll(async () => { rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); client = await MongoClient.connect(rs.getUri('mig')); });
afterAll(async () => { await client.close(); await rs.stop(); });

it('migrations are idempotent and reversible; tenant-owned indexes lead with tenantId', async () => {
  const db = client.db();
  expect((await migrateUp(db)).length).toBe(1);
  expect(await migrateUp(db)).toEqual([]);
  for (const i of INDEXES) {
    if (['tenants', 'users'].includes(i.collection)) continue;
    const leadsWithTenant = Object.keys(i.keys)[0] === 'tenantId';
    const globalSafe = ['publicId', 'tokenHash', 'userId', 'expiresAt', 'receivedAt', 'dispatchedAt', 'provider', 'at', 'createdAt', 'dueAt', 'sla.claimDueAt', 'sla.firstContactDueAt'].includes(Object.keys(i.keys)[0]);
    expect(leadsWithTenant || globalSafe, `${i.collection} ${JSON.stringify(i.keys)}`).toBe(true);
  }
  expect(await migrateDown(db)).toBe('20250101000001-init');
  expect((await migrateUp(db)).length).toBe(1);
});

it('every indexed collection corresponds to a real model collection (no silent name drift)', async () => {
  const { buildModels } = await import('../src/models');
  const mongoose = (await import('mongoose')).default;
  const conn = mongoose.createConnection();
  const names = new Set(Object.values(buildModels(conn)).map((m: any) => m.collection.name));
  for (const i of INDEXES) expect(names.has(i.collection), i.collection).toBe(true);
});
