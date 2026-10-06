import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalKeyService, sealSecret } from '@leaddesk/crypto';
import { migrateUp, runWithTenant, runAsSystem, newObjectId } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any; let db: any;
const jobs: any[] = [];
const secret = 'whsec_test_123456';
let publicId: string; let tenantId: string; let connId: string;
const sign = (b: string) => 'sha256=' + createHmac('sha256', secret).update(b).digest('hex');

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('ingress_test');
  const kek = randomBytes(32);
  process.env.LOCAL_KEK_BASE64 = kek.toString('base64');
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { IngressModule } = await import('../src/ingress.module');
  const { INBOX_QUEUE } = await import('../src/inbox-queue');
  const { TENANT_DB } = await import('@leaddesk/platform');
  const mod = await Test.createTestingModule({ imports: [IngressModule] })
    .overrideProvider(INBOX_QUEUE).useValue({ enqueue: async (j: any) => { jobs.push(j); } }).compile();
  app = mod.createNestApplication({ rawBody: true });
  await app.init();
  http = app.getHttpServer();
  db = mod.get(TENANT_DB);
  const tenant: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'T', slug: 't' }));
  tenantId = String(tenant._id);
  connId = String(newObjectId());
  publicId = 'pub_' + randomBytes(8).toString('hex');
  const sealed = await sealSecret(new LocalKeyService(kek), { tenantId, connectionId: connId }, JSON.stringify({ signingSecret: secret }));
  await runWithTenant(tenantId, () => db.repos.connections.create({
    _id: connId, provider: 'website-webhook', category: 'lead_source', name: 'site', publicId, status: 'verified',
    secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: sealed.hint,
  }));
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

const post = (body: string, headers: Record<string, string>) =>
  request(http).post(`/hooks/website-webhook/${publicId}`).set('Content-Type', 'application/json').set(headers).send(body);

describe('webhook ingress', () => {
  it('rejects bad/missing signature with 401 and stores nothing', async () => {
    const body = JSON.stringify({ id: 'L1', name: 'A' });
    await post(body, { 'x-event-id': 'e-bad', 'x-signature-256': 'sha256=' + '0'.repeat(64) }).expect(401);
    await post(body, { 'x-event-id': 'e-none' }).expect(401);
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count())).toBe(0);
  });
  it('404s for unknown public id, wrong provider, and GET', async () => {
    await request(http).post('/hooks/website-webhook/nope').send('{}').expect(404);
    await request(http).post(`/hooks/meta/${publicId}`).send('{}').expect(404);
    await request(http).get(`/hooks/website-webhook/${publicId}`).expect(404);
  });
  it('replaying the same webhook 5x yields exactly 1 inbox row and 1 job', async () => {
    const body = JSON.stringify({ id: 'L2', name: 'B', phone: '9876543210' });
    for (let i = 0; i < 5; i++) await post(body, { 'x-event-id': 'e-replay', 'x-signature-256': sign(body) }).expect(200);
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count({ externalEventId: 'e-replay' }))).toBe(1);
    expect(jobs.filter((j) => j.tenantId === tenantId)).toHaveLength(1);
    const row: any = await runWithTenant(tenantId, () => db.repos.inbox.findOne({ externalEventId: 'e-replay' }));
    expect(row.rawPayload.id).toBe('L2');
    expect(row.signatureValid).toBe(true);
  });
  it('concurrent duplicates are still idempotent', async () => {
    const body = JSON.stringify({ id: 'L3' });
    await Promise.all(Array.from({ length: 10 }, () => post(body, { 'x-event-id': 'e-conc', 'x-signature-256': sign(body) })));
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count({ externalEventId: 'e-conc' }))).toBe(1);
  });
  it('acks fast', async () => {
    const body = JSON.stringify({ id: 'L4' });
    const t = Date.now();
    await post(body, { 'x-event-id': 'e-fast', 'x-signature-256': sign(body) }).expect(200);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
