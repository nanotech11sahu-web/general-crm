import { createHmac, randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, type Connector, type FetchLike } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { createSystemOps, migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { AiService, BillingService, CadenceService, LeadService, createRazorpay, loadPlans, publicPlans, seedPreset, type PaymentProvider, type ProviderEvent } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let sys: any;
const DAY = 86_400_000; const T0 = new Date('2026-03-10T06:30:00Z');
const clock = { t: T0 };
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
const calls: any[] = [];
const fakeProvider: PaymentProvider = {
  id: 'razorpay',
  async createSubscription(i) { calls.push(['create', i]); return { providerSubscriptionId: `sub_${calls.length}`, url: `https://rzp.io/i/${calls.length}` }; },
  async cancel(id, atEnd) { calls.push(['cancel', id, atEnd]); }, async updateSeats(id, n) { calls.push(['seats', id, n]); },
  verifyWebhook: () => true, eventId: () => 'e', parseEvent: () => null,
};
const svc = (t?: PaymentProvider) => new BillingService(db, () => clock.t, t);
const mkTenant = async (slug: string) => { const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug })); const id = String(t._id); await as(id, () => seedPreset(db.repos, 'generic')); return id; };
const addMember = (t: string, n = 1) => as(t, async () => { for (let i = 0; i < n; i++) await db.repos.memberships.create({ userId: `65f0000000000000000${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`, role: 'agent', status: 'active' }); });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('bill_test'); const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); sys = createSystemOps(db.models);
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('plans', () => {
  it('has placeholder prices that can be patched per environment; only paid plans are public', () => {
    expect(publicPlans().map((p) => p.key)).toEqual(['starter', 'growth', 'scale']);
    const p = loadPlans({ PLANS_JSON: JSON.stringify({ starter: { pricePerSeatInr: 499, limits: { maxSeats: 20 } } }) } as any);
    expect(p.starter).toMatchObject({ pricePerSeatInr: 499, key: 'starter' }); expect(p.starter.limits).toMatchObject({ maxSeats: 20, connections: 3 }); expect(p.growth.pricePerSeatInr).toBe(1299);
  });
});

describe('trial and status rolling', () => {
  it('every workspace gets a 14-day trial lazily; statuses roll forward with time', async () => {
    clock.t = T0; const T = await mkTenant('b1');
    const e0 = await as(T, () => svc().entitlements());
    expect(e0).toMatchObject({ status: 'trialing', plan: 'trial', seats: 5, restricted: false, trialDaysLeft: 14 });
    expect(await as(T, () => db.repos.subscriptions.count({}))).toBe(1); await as(T, () => svc().entitlements()); expect(await as(T, () => db.repos.subscriptions.count({}))).toBe(1); // one row, ever
    clock.t = new Date(T0.getTime() + 13.5 * DAY); expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'trialing', trialDaysLeft: 1, restricted: false });
    clock.t = new Date(T0.getTime() + 14 * DAY + 1000);
    const e1 = await as(T, () => svc().entitlements()); expect(e1).toMatchObject({ status: 'expired', restricted: true }); expect(e1.reason).toContain('free trial has ended');
    // pure rules: grace for past-due, cancellation runs to period end
    const plans = loadPlans(); const now = new Date('2026-04-01T00:00:00Z');
    expect(BillingService.effective({ plan: 'growth', seats: 5, status: 'past_due', pastDueSince: new Date(now.getTime() - 3 * DAY) }, plans, now).restricted).toBe(false);
    expect(BillingService.effective({ plan: 'growth', seats: 5, status: 'past_due', pastDueSince: new Date(now.getTime() - 8 * DAY) }, plans, now)).toMatchObject({ restricted: true, status: 'past_due' });
    expect(BillingService.effective({ plan: 'growth', seats: 5, status: 'canceled', currentPeriodEnd: new Date(now.getTime() + 5 * DAY), cancelAtPeriodEnd: true }, plans, now).restricted).toBe(false);
    expect(BillingService.effective({ plan: 'growth', seats: 5, status: 'canceled', currentPeriodEnd: new Date(now.getTime() - DAY), cancelAtPeriodEnd: true }, plans, now)).toMatchObject({ status: 'expired', restricted: true });
    clock.t = T0;
  });
  it('extending a trial reopens an expired workspace', async () => {
    const T = await mkTenant('b2'); clock.t = new Date(T0.getTime() + 20 * DAY);
    await as(T, async () => { await db.repos.subscriptions.create({ plan: 'trial', seats: 5, status: 'trialing', trialEndsAt: new Date(T0.getTime() + 14 * DAY) }); });
    expect((await as(T, () => svc().entitlements())).restricted).toBe(true);
    await as(T, () => svc().extendTrial(10)); expect(await as(T, () => svc().entitlements())).toMatchObject({ restricted: false, status: 'trialing', trialDaysLeft: 10 });
    await expect(as(T, () => svc().extendTrial(500))).rejects.toMatchObject({ code: 'invalid_days' });
    clock.t = T0;
  });
});

describe('enforcement', () => {
  it('seats count members plus open invitations and refuse (402) beyond the plan', async () => {
    clock.t = T0; const T = await mkTenant('b3'); await addMember(T, 4);
    await as(T, () => svc().assertSeatAvailable()); // 4 of 5
    await as(T, () => db.repos.invitations.create({ email: 'x@x.io', role: 'agent', tokenHash: 'h', invitedBy: '65f000000000000000000001', expiresAt: new Date(T0.getTime() + DAY) }));
    await expect(as(T, () => svc().assertSeatAvailable())).rejects.toMatchObject({ code: 'seat_limit', status: 402, details: { seats: 5, used: 5 } });
    await as(T, () => db.repos.invitations.updateOne({ email: 'x@x.io' }, { $set: { expiresAt: new Date(T0.getTime() - 1000) } })); // an expired invite frees its seat
    await as(T, () => svc().assertSeatAvailable());
  });
  it('plan limits: cloud calling, AI and connection count', async () => {
    clock.t = T0; const T = await mkTenant('b4');
    await as(T, () => svc().setManual({ plan: 'starter', seats: 5 }));
    await expect(as(T, () => svc().assertCanConnect('voice'))).rejects.toMatchObject({ code: 'plan_limit', status: 402, details: { feature: 'cloudTelephony' } });
    await expect(as(T, () => svc().assertCanConnect('ai'))).rejects.toMatchObject({ details: { feature: 'ai' } });
    await as(T, () => svc().assertCanConnect('lead_source'));
    await as(T, async () => { for (let i = 0; i < 3; i++) await db.repos.connections.create({ provider: 'website-webhook', category: 'lead_source', name: `c${i}`, publicId: `p${i}-${randomBytes(3).toString('hex')}`, status: 'verified' }); });
    await expect(as(T, () => svc().assertCanConnect('lead_source'))).rejects.toMatchObject({ details: { feature: 'connections', limit: 3 } });
    await as(T, () => svc().setManual({ plan: 'growth', seats: 5 })); await as(T, () => svc().assertCanConnect('voice')); // upgrade unlocks
  });
  it('usage reports seats, leads vs the soft cap and never blocks intake', async () => {
    clock.t = T0; const T = await mkTenant('b5'); await as(T, () => svc().setManual({ plan: 'starter', seats: 5 }));
    await as(T, () => db.models.Tenant.updateOne({ _id: T }, { $set: { plan: 'starter' } }));
    const u0: any = await as(T, () => svc().usage()); expect(u0).toMatchObject({ leads: { created: 0, softLimit: 2000, nearLimit: false, overLimit: false }, seats: { limit: 5 }, connections: { limit: 3 } });
    await as(T, () => db.repos.subscriptions.updateOne({}, { $set: { plan: 'starter' } }));
    const leads = new LeadService(db); expect((await as(T, () => leads.intake({ name: 'Still Taken', contacts: [{ value: '9812300001' }] }))).outcome).toBe('created'); // intake has no billing gate
  });
  it('expired workspaces pause automation and AI (no background spend), but nothing is deleted', async () => {
    clock.t = new Date(T0.getTime() + 30 * DAY); const T = await mkTenant('b6');
    await as(T, () => db.repos.subscriptions.create({ plan: 'trial', seats: 5, status: 'trialing', trialEndsAt: new Date(T0.getTime() + 14 * DAY) }));
    const fakeAi: Connector = { manifest: { id: 'fake-ai', category: 'ai', displayName: 'x', logo: '', docsUrl: '', auth: { type: 'api_key' }, capabilities: ['ai.chat'], credentialFields: [], configFields: [] }, async verify() { return { ok: true }; }, async health() { return { ok: true }; } };
    const reg = new ConnectorRegistry().register(fakeAi); const keys = new LocalKeyService(randomBytes(32));
    expect(await as(T, () => new AiService(db, keys, reg, { now: () => clock.t }).assessPending())).toEqual({ assessed: 0, skipped: 0 });
    const cad = new CadenceService(db, keys, reg, () => clock.t);
    const e: any = await as(T, async () => { const lead: any = await db.repos.leads.create({ displayName: 'L', nameTokens: ['l'], contacts: [] }); return db.repos.enrollments.create({ leadId: lead._id, dedupeKey: 'k', kind: 'cadence', steps: [{ runAt: T0, action: 'task', note: 'Call the lead about visit', done: false }], stepIndex: 0, state: 'active', nextRunAt: T0 }); });
    expect(await as(T, () => cad.runDue(String(e._id)))).toBe('idle');
    expect((await as(T, () => db.repos.enrollments.findById(e._id)) as any).state).toBe('active'); // waiting, not dropped
    clock.t = T0;
  });
  it('AI cannot be switched on when the plan does not include it', async () => {
    clock.t = T0; const T = await mkTenant('b7'); await as(T, () => svc().setManual({ plan: 'starter', seats: 5 }));
    const keys = new LocalKeyService(randomBytes(32)); const reg = new ConnectorRegistry();
    await expect(as(T, () => new AiService(db, keys, reg, { now: () => clock.t }).updateSettings({ enabled: true }))).rejects.toMatchObject({ code: 'plan_limit', status: 402 });
  });
});

describe('checkout, seats, cancel and provider events', () => {
  it('checkout validates plan and seat range, stores a pending subscription and returns the hosted payment link', async () => {
    clock.t = T0; calls.length = 0; const T = await mkTenant('c1'); await addMember(T, 3);
    await expect(as(T, () => svc().checkout({ plan: 'starter', seats: 2, email: 'o@x.io' }))).rejects.toMatchObject({ code: 'payments_unavailable' });
    await expect(as(T, () => svc(fakeProvider).checkout({ plan: 'trial', seats: 3, email: 'o@x.io' }))).rejects.toMatchObject({ code: 'unknown_plan' });
    await expect(as(T, () => svc(fakeProvider).checkout({ plan: 'starter', seats: 2, email: 'o@x.io' }))).rejects.toMatchObject({ code: 'invalid_seats', details: { min: 3, max: 10 } }); // fewer seats than people
    await expect(as(T, () => svc(fakeProvider).checkout({ plan: 'starter', seats: 11, email: 'o@x.io' }))).rejects.toMatchObject({ code: 'invalid_seats' });
    const r = await as(T, () => svc(fakeProvider).checkout({ plan: 'growth', seats: 6, email: 'o@x.io' }));
    expect(r.url).toMatch(/^https:\/\/rzp\.io/); expect(calls[0]).toEqual(['create', { plan: 'growth', seats: 6, tenantId: T, email: 'o@x.io' }]);
    expect((await as(T, () => svc(fakeProvider).overview()) as any).pending).toMatchObject({ plan: 'growth', seats: 6 });
    // not charged until the provider says so: still a trial
    expect(await as(T, () => svc(fakeProvider).entitlements())).toMatchObject({ status: 'trialing', plan: 'trial' });
  });

  it('activation applies plan, seats and period from the event; replays and reordering converge; failures start a grace period; recovery clears it', async () => {
    clock.t = T0; const T = await mkTenant('c2'); await addMember(T, 2);
    await as(T, () => svc(fakeProvider).checkout({ plan: 'growth', seats: 8, email: 'o@x.io' })); const subId = ((await as(T, () => svc().overview())) as any).pending ? (await as(T, () => db.repos.subscriptions.findOne({})) as any).providerSubscriptionId : '';
    const periodEnd = new Date(T0.getTime() + 30 * DAY);
    const ev = (kind: ProviderEvent['kind'], o: Partial<ProviderEvent> = {}): ProviderEvent => ({ provider: 'razorpay', eventId: `${kind}-${Math.random()}`, kind, providerSubscriptionId: subId, tenantId: T, ...o });
    expect(await as(T, () => svc(fakeProvider).applyProviderEvent(ev('activated', { plan: 'growth', seats: 8, periodEnd })))).toBe('applied');
    expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'active', plan: 'growth', seats: 8, restricted: false, currentPeriodEnd: periodEnd });
    expect(((await db.models.Tenant.findById(T).lean().exec()) as any).plan).toBe('growth');
    await as(T, () => svc().applyProviderEvent(ev('activated', { plan: 'growth', seats: 8, periodEnd }))); // replay
    await as(T, () => svc().applyProviderEvent(ev('past_due'))); expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'past_due', restricted: false }); // grace
    clock.t = new Date(T0.getTime() + 8 * DAY); expect(await as(T, () => svc().entitlements())).toMatchObject({ restricted: true });
    await as(T, () => svc().applyProviderEvent(ev('charged', { periodEnd: new Date(T0.getTime() + 60 * DAY) }))); expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'active', restricted: false });
    expect(await as(T, () => svc().applyProviderEvent(ev('other')))).toBe('ignored');
    expect(await as(T, () => svc().applyProviderEvent(ev('charged', { providerSubscriptionId: 'sub_someone_else' })))).toBe('ignored'); // an abandoned subscription cannot change this workspace
    clock.t = T0;
  });

  it('seat changes call the provider and respect people already on the team; cancel runs to the end of the period; completed expires', async () => {
    clock.t = T0; calls.length = 0; const T = await mkTenant('c3'); await addMember(T, 4);
    await as(T, () => svc().setManual({ plan: 'growth', seats: 6, periodEnd: new Date(T0.getTime() + 20 * DAY) }));
    await expect(as(T, () => svc(fakeProvider).changeSeats(3))).rejects.toMatchObject({ code: 'invalid_seats', details: { min: 4 } });
    expect((await as(T, () => svc(fakeProvider).changeSeats(9)) as any).seats).toBe(9);
    expect(calls.some((c) => c[0] === 'seats')).toBe(false); // a manual (invoiced) subscription never calls the payment provider
    await as(T, () => db.repos.subscriptions.updateOne({}, { $set: { provider: 'razorpay', providerSubscriptionId: 'sub_9' } }));
    await as(T, () => svc(fakeProvider).changeSeats(7)); expect(calls.at(-1)).toEqual(['seats', 'sub_9', 7]);
    const c = await as(T, () => svc(fakeProvider).cancel()); expect(c).toMatchObject({ cancelAtPeriodEnd: true, restricted: false }); expect(calls.at(-1)).toEqual(['cancel', 'sub_9', true]);
    clock.t = new Date(T0.getTime() + 21 * DAY); expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'expired', restricted: true });
    await expect(as(T, () => svc(fakeProvider).cancel())).rejects.toMatchObject({ code: 'not_subscribed' });
    clock.t = T0;
  });

  it('other workspaces are never touched', async () => {
    clock.t = T0; const A = await mkTenant('c4a'); const B = await mkTenant('c4b');
    await as(A, () => svc().setManual({ plan: 'scale', seats: 100 }));
    expect(await as(B, () => svc().entitlements())).toMatchObject({ plan: 'trial', status: 'trialing' });
  });
});

describe('razorpay provider (documented-shape fixtures; not verified live)', () => {
  const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  const planIds = { starter: 'plan_S', growth: 'plan_G', scale: 'plan_X' };
  it('creates a subscription with basic auth, quantity and tenant notes; cancel and seat change use the documented calls', async () => {
    const seen: any[] = [];
    const f: FetchLike = async (url, init) => { seen.push({ url, method: init?.method, headers: init?.headers, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return resp(200, { id: 'sub_123', short_url: 'https://rzp.io/i/abc' }); };
    const p = createRazorpay({ keyId: 'rzp_key', keySecret: 'rzp_secret', webhookSecret: 'whsec', planIds, fetch: f });
    expect(await p.createSubscription({ plan: 'growth', seats: 6, tenantId: 't1', email: 'o@x.io' })).toEqual({ providerSubscriptionId: 'sub_123', url: 'https://rzp.io/i/abc' });
    expect(seen[0]).toMatchObject({ url: 'https://api.razorpay.com/v1/subscriptions', method: 'POST', body: { plan_id: 'plan_G', quantity: 6, total_count: 120, customer_notify: 1, notes: { tenant_id: 't1', plan: 'growth' } } });
    expect(seen[0].headers.authorization).toBe('Basic ' + Buffer.from('rzp_key:rzp_secret').toString('base64'));
    await p.cancel('sub_123', true); expect(seen[1]).toMatchObject({ url: 'https://api.razorpay.com/v1/subscriptions/sub_123/cancel', method: 'POST', body: { cancel_at_cycle_end: 1 } });
    await p.updateSeats('sub_123', 9); expect(seen[2]).toMatchObject({ url: 'https://api.razorpay.com/v1/subscriptions/sub_123', method: 'PATCH', body: { quantity: 9, schedule_change_at: 'cycle_end' } });
    await expect(createRazorpay({ keyId: 'k', keySecret: 's', webhookSecret: 'w', planIds: {}, fetch: f }).createSubscription({ plan: 'growth', seats: 1, tenantId: 't', email: 'e' })).rejects.toThrow(/No Razorpay plan id/);
    await expect(createRazorpay({ keyId: 'k', keySecret: 's', webhookSecret: 'w', planIds, fetch: async () => resp(400, { error: { description: 'plan is inactive' } }) }).cancel('x', true)).rejects.toThrow(/plan is inactive/);
  });
  it('verifies the webhook HMAC over the raw body and maps subscription events', () => {
    const p = createRazorpay({ keyId: 'k', keySecret: 's', webhookSecret: 'whsec', planIds });
    const raw = Buffer.from(JSON.stringify({ event: 'subscription.charged' })); const sig = createHmac('sha256', 'whsec').update(raw).digest('hex');
    expect(p.verifyWebhook(raw, { 'x-razorpay-signature': sig })).toBe(true); expect(p.verifyWebhook(raw, { 'x-razorpay-signature': sig.replace(/.$/, '0') })).toBe(false); expect(p.verifyWebhook(raw, {})).toBe(false);
    expect(p.verifyWebhook(Buffer.from('{"tampered":1}'), { 'x-razorpay-signature': sig })).toBe(false);
    expect(createRazorpay({ keyId: 'k', keySecret: 's', webhookSecret: '', planIds }).verifyWebhook(raw, { 'x-razorpay-signature': sig })).toBe(false); // no secret configured: nothing verifies
    expect(p.eventId(raw, { 'x-razorpay-event-id': 'evt_1' })).toBe('evt_1'); expect(p.eventId(raw, {})).toMatch(/^[0-9a-f]{64}$/);
    const e = p.parseEvent({ id: 'evt_1', event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_1', plan_id: 'plan_G', quantity: 7, current_end: 1_800_000_000, notes: { tenant_id: 'tt' } } } } });
    expect(e).toEqual({ provider: 'razorpay', eventId: 'evt_1', kind: 'charged', providerSubscriptionId: 'sub_1', tenantId: 'tt', plan: 'growth', seats: 7, periodEnd: new Date(1_800_000_000_000) });
    expect(p.parseEvent({ event: 'subscription.halted', payload: { subscription: { entity: { id: 's' } } } })!.kind).toBe('past_due');
    expect(p.parseEvent({ event: 'payment.failed', payload: { payment: { entity: { subscription_id: 'sub_9' } } } })).toMatchObject({ kind: 'past_due', providerSubscriptionId: 'sub_9' });
    expect(p.parseEvent({ event: 'order.paid' })).toBeNull();
  });
  it('events are stored once, resolved to a tenant (notes or our stored subscription id), applied, and retried when processing failed', async () => {
    clock.t = T0; const T = await mkTenant('r1'); const provider = createRazorpay({ keyId: 'k', keySecret: 's', webhookSecret: 'w', planIds });
    await as(T, async () => { const b = new BillingService(db, () => clock.t, fakeProvider); await addMember(T, 1); await b.checkout({ plan: 'starter', seats: 4, email: 'o@x.io' }); });
    const subId = ((await as(T, () => db.repos.subscriptions.findOne({}))) as any).providerSubscriptionId;
    const payload = { id: 'evt_a1', event: 'subscription.activated', payload: { subscription: { entity: { id: subId, plan_id: 'plan_S', quantity: 4, current_end: Math.floor((T0.getTime() + 30 * DAY) / 1000) } } } }; // no tenant note: found through our stored id
    const first = await sys.recordBillingEvent('razorpay', 'evt_a1', 'subscription.activated', payload); expect(first.created).toBe(true);
    const dup = await sys.recordBillingEvent('razorpay', 'evt_a1', 'subscription.activated', payload); expect(dup.created).toBe(false);
    expect(await BillingService.processEvent(db, sys, provider, first.event, () => clock.t)).toBe(true);
    expect(await as(T, () => svc().entitlements())).toMatchObject({ status: 'active', plan: 'starter', seats: 4 });
    const row: any = await runAsSystem('test', () => db.models.BillingEvent.findOne({ eventId: 'evt_a1' }).lean().exec()); expect(row).toMatchObject({ status: 'done', attempts: 1 }); expect(String(row.tenantId)).toBe(T);
    // unknown tenant -> ignored, never throws; a failure is marked and retried by the worker sweep
    const orphan = await sys.recordBillingEvent('razorpay', 'evt_x', 'subscription.charged', { id: 'evt_x', event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_unknown' } } } });
    expect(await BillingService.processEvent(db, sys, provider, orphan.event, () => clock.t)).toBe(true);
    const boom = await sys.recordBillingEvent('razorpay', 'evt_f', 'subscription.charged', payload);
    const failing = { ...provider, parseEvent: () => { throw new Error('db blinked'); } } as PaymentProvider;
    expect(await BillingService.processEvent(db, sys, failing, boom.event)).toBe(false);
    expect(((await runAsSystem('test', () => db.models.BillingEvent.findOne({ eventId: 'evt_f' }).lean().exec())) as any).status).toBe('failed');
    expect((await BillingService.retryEvents(db, sys, provider, () => clock.t)).done).toBeGreaterThanOrEqual(1);
    expect(((await runAsSystem('test', () => db.models.BillingEvent.findOne({ eventId: 'evt_f' }).lean().exec())) as any).status).toMatch(/done|ignored/);
  });
});
