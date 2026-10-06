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

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any;
const secret = 'whsec_test_123456'; let publicId: string;
const sign = (b: string) => 'sha256=' + createHmac('sha256', secret).update(b).digest('hex');
let dbRef: any; let tenantRef: string;
const hook = (body: string, sig: string, eid: string) => request(http).post(`/hooks/website-webhook/${publicId}`).set('Content-Type', 'application/json').set('x-signature-256', sig).set('x-event-id', eid).send(body);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('ingress_burst'); const kek = randomBytes(32); process.env.LOCAL_KEK_BASE64 = kek.toString('base64');
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { IngressModule } = await import('../src/ingress.module'); const { INBOX_QUEUE } = await import('../src/inbox-queue'); const { configureIngress } = await import('../src/setup');
  const { TENANT_DB } = await import('@leaddesk/platform');
  const mod = await Test.createTestingModule({ imports: [IngressModule] }).overrideProvider(INBOX_QUEUE).useValue({ enqueue: async () => undefined }).compile();
  const { MemoryRateStore, rateConfigFromEnv } = await import('@leaddesk/platform'); // production wiring with the default (generous) limits: a burst must not be throttled
  app = configureIngress(mod.createNestApplication({ rawBody: true }), { store: new MemoryRateStore(), cfg: rateConfigFromEnv({} as any) }); await app.init(); http = app.getHttpServer();
  const db: any = mod.get(TENANT_DB); dbRef = db;
  const tenant: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'T', slug: 't' })); const tenantId = String(tenant._id); tenantRef = tenantId; const connId = String(newObjectId());
  publicId = 'pub_' + randomBytes(8).toString('hex');
  const sealed = await sealSecret(new LocalKeyService(kek), { tenantId, connectionId: connId }, JSON.stringify({ signingSecret: secret }));
  await runWithTenant(tenantId, () => db.repos.connections.create({ _id: connId, provider: 'website-webhook', category: 'lead_source', name: 'site', publicId, status: 'verified', secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: sealed.hint }));
});
afterAll(async () => { await app?.close(); await rs?.stop(); });


describe('webhook load (spec: 1k leads/min sustained, ack < 100 ms)', () => {
  const send = (i: number) => { const b = JSON.stringify({ externalRef: `burst-${i}`, name: `Burst ${i}`, phone: `98${String(10000000 + i)}` }); return hook(b, sign(b), `burst-${i}`); };
  const count = () => runWithTenant(tenantRef, () => dbRef.repos.inbox.count({ provider: 'website-webhook' }));
  const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];

  it('at a realistic arrival rate (4 in flight) the ack p95 is under 100 ms', async () => {
    const lat: number[] = [];
    const worker = async (from: number) => { for (let i = from; i < from + 75; i++) { const t0 = performance.now(); const r = await send(100_000 + i); lat.push(performance.now() - t0); expect(r.status).toBe(200); } };
    await Promise.all([0, 75, 150, 225].map(worker));
    console.log(`steady: ack p50=${pct(lat, 0.5).toFixed(1)}ms p95=${pct(lat, 0.95).toFixed(1)}ms p99=${pct(lat, 0.99).toFixed(1)}ms`);
    expect(pct(lat, 0.95)).toBeLessThan(100);
  }, 120_000);

  it('a 1,000-event burst at concurrency 50 runs far above 1k/min on one process, stores each event exactly once and absorbs redelivery', async () => {
    const before = await count(); const lat: number[] = []; let ok = 0;
    const run = async (from: number, to: number) => { for (let i = from; i < to; i++) { const t0 = performance.now(); const r = await send(i); lat.push(performance.now() - t0); if (r.status === 200) ok++; } };
    const t0 = performance.now(); await Promise.all(Array.from({ length: 50 }, (_, w) => run(w * 20, (w + 1) * 20))); const wall = (performance.now() - t0) / 1000;
    console.log(`burst: ${ok}/1000 ok in ${wall.toFixed(1)}s (${Math.round((1000 / wall) * 60)}/min); latency under saturation p95=${pct(lat, 0.95).toFixed(0)}ms`);
    expect(ok).toBe(1000); expect((1000 / wall) * 60).toBeGreaterThan(1000);
    expect(pct(lat, 0.99)).toBeLessThan(2000); // saturated: queueing, but nothing times out or errors
    expect((await count()) - before).toBe(1000);
    const r = await Promise.all(Array.from({ length: 200 }, (_, i) => send(i * 5))); // at-least-once delivery: replaying 200 creates nothing new
    expect(r.every((x) => x.status === 200)).toBe(true); expect((await count()) - before).toBe(1000);
  }, 120_000);
});
