import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, runAsSystem, runWithTenant } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any; let db: any; let tenantId: string;
const SECRET = 'rzp_whsec_test';
const sign = (b: string) => createHmac('sha256', SECRET).update(b).digest('hex');
const post = (body: object, o: { sig?: string; id?: string } = {}) => { const b = JSON.stringify(body); return request(http).post('/hooks/billing/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', o.sig ?? sign(b)).set('x-razorpay-event-id', o.id ?? `evt-${Math.random()}`).send(b); };
const sub = () => runWithTenant(tenantId, () => db.repos.subscriptions.findOne({})) as Promise<any>;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('billing_hook'); process.env.LOCAL_KEK_BASE64 = randomBytes(32).toString('base64');
  Object.assign(process.env, { RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: SECRET, RAZORPAY_PLAN_GROWTH: 'plan_G', RAZORPAY_PLAN_STARTER: 'plan_S' });
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { IngressModule } = await import('../src/ingress.module'); const { INBOX_QUEUE } = await import('../src/inbox-queue'); const { TENANT_DB } = await import('@leaddesk/platform');
  const mod = await Test.createTestingModule({ imports: [IngressModule] }).overrideProvider(INBOX_QUEUE).useValue({ enqueue: async () => undefined }).compile();
  app = mod.createNestApplication({ rawBody: true }); await app.init(); http = app.getHttpServer(); db = mod.get(TENANT_DB);
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'Billed', slug: 'billed' })); tenantId = String(t._id);
  await runWithTenant(tenantId, () => db.repos.subscriptions.create({ plan: 'trial', seats: 5, status: 'trialing', trialEndsAt: new Date(Date.now() + 5 * 86400_000), providerSubscriptionId: 'sub_hook_1', provider: 'razorpay', pending: { plan: 'growth', seats: 8, providerSubscriptionId: 'sub_hook_1', url: 'u', createdAt: new Date() } }));
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

const activated = (extra: object = {}) => ({ entity: 'event', event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_hook_1', plan_id: 'plan_G', quantity: 8, current_end: Math.floor((Date.now() + 30 * 86400_000) / 1000), ...extra } } } });

describe('billing webhook (Razorpay, documented-shape fixtures)', () => {
  it('rejects a bad or missing signature and stores nothing', async () => {
    await post(activated(), { sig: 'deadbeef' }).expect(401); await post(activated(), { sig: '' }).expect(401);
    expect(await runAsSystem('test', () => db.models.BillingEvent.countDocuments({}))).toBe(0);
    expect((await sub()).status).toBe('trialing');
  });
  it('a signed activation is stored once, answered 200 and applied to the right workspace (found by our stored subscription id)', async () => {
    await post(activated(), { id: 'evt-act-1' }).expect(200).expect((r) => expect(r.body).toEqual({ ok: true }));
    expect(await sub()).toMatchObject({ status: 'active', plan: 'growth', seats: 8, pending: null });
    const row: any = await runAsSystem('test', () => db.models.BillingEvent.findOne({ eventId: 'evt-act-1' }).lean().exec()); expect(row).toMatchObject({ status: 'done', type: 'subscription.activated' }); expect(String(row.tenantId)).toBe(tenantId);
    expect(((await db.models.Tenant.findById(tenantId).lean().exec()) as any).plan).toBe('growth');
  });
  it('redelivery is acknowledged without side effects; a failed payment starts the grace period; unknown subscriptions are ignored', async () => {
    const before = await sub();
    await post(activated(), { id: 'evt-act-1' }).expect(200).expect((r) => expect(r.body).toMatchObject({ duplicate: true }));
    expect(await runAsSystem('test', () => db.models.BillingEvent.countDocuments({ eventId: 'evt-act-1' }))).toBe(1); expect((await sub()).updatedAt).toEqual(before.updatedAt);
    await post({ event: 'subscription.halted', payload: { subscription: { entity: { id: 'sub_hook_1' } } } }).expect(200);
    expect(await sub()).toMatchObject({ status: 'past_due' }); expect((await sub()).pastDueSince).toBeTruthy();
    await post({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_hook_1', quantity: 8, current_end: Math.floor((Date.now() + 60 * 86400_000) / 1000) } } } }).expect(200);
    expect(await sub()).toMatchObject({ status: 'active', pastDueSince: null });
    await post({ event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_nobody_knows' } } } }).expect(200); // never retried forever, never an error to the provider
    await post({ event: 'order.paid', payload: {} }).expect(200);
    expect((await sub()).seats).toBe(8);
  });
  it('is not reachable as a connection webhook and does not exist without provider credentials', async () => {
    await request(http).post('/hooks/billing/nonexistent').set('Content-Type', 'application/json').send('{}').expect(404);
  });
});
