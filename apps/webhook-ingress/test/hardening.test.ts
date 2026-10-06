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
import { MemoryRateStore, rateConfigFromEnv } from '@leaddesk/platform';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any;
const secret = 'whsec_test_123456'; let publicId: string;
const sign = (b: string) => 'sha256=' + createHmac('sha256', secret).update(b).digest('hex');
const hook = (body: string, sig: string) => request(http).post(`/hooks/website-webhook/${publicId}`).set('Content-Type', 'application/json').set('x-signature', sig).send(body);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('ingress_hard'); const kek = randomBytes(32); process.env.LOCAL_KEK_BASE64 = kek.toString('base64');
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { IngressModule } = await import('../src/ingress.module'); const { INBOX_QUEUE } = await import('../src/inbox-queue'); const { configureIngress } = await import('../src/setup');
  const { TENANT_DB } = await import('@leaddesk/platform');
  const mod = await Test.createTestingModule({ imports: [IngressModule] }).overrideProvider(INBOX_QUEUE).useValue({ enqueue: async () => undefined }).compile();
  const cfg = rateConfigFromEnv({ RATE_LIMIT_SCALE: '0.01' } as any); // webhook 12/min per connection
  app = configureIngress(mod.createNestApplication({ rawBody: true }), { store: new MemoryRateStore(), cfg }); await app.init(); http = app.getHttpServer();
  const db: any = mod.get(TENANT_DB);
  const tenant: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'T', slug: 't' })); const tenantId = String(tenant._id); const connId = String(newObjectId());
  publicId = 'pub_' + randomBytes(8).toString('hex');
  const sealed = await sealSecret(new LocalKeyService(kek), { tenantId, connectionId: connId }, JSON.stringify({ signingSecret: secret }));
  await runWithTenant(tenantId, () => db.repos.connections.create({ _id: connId, provider: 'website-webhook', category: 'lead_source', name: 'site', publicId, status: 'verified', secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: sealed.hint }));
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

describe('ingress hardening', () => {
  it('health endpoints answer without auth and without touching tenant data', async () => {
    expect((await request(http).get('/healthz').expect(200)).body).toEqual({ status: 'ok' });
    expect((await request(http).get('/readyz').expect(200)).body).toEqual({ status: 'ready' });
  });
  it('adds security headers and a safe request id to every response', async () => {
    const r = await hook('{}', 'sha256=bad');
    expect(r.status).toBe(401); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['x-powered-by']).toBeUndefined(); expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('repeated bad signatures from one address are cut off (429) while the per-connection ceiling protects other tenants', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 20; i++) codes.push((await hook(JSON.stringify({ i }), 'sha256=00')).status);
    expect(codes[0]).toBe(401); expect(codes.at(-1)).toBe(429); // either the ceiling (12/min) or the bad-signature counter ended the burst
    const r = await hook('{}', sign('{}'));
    expect(r.status).toBe(429); expect(Number(r.headers['retry-after'])).toBeGreaterThan(0); expect(r.body.code).toBe('rate_limited');
  });
});
