import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createHttp, HttpError, type FetchLike } from '@leaddesk/connectors-core';
import type { PlanKey } from './plans';

/** What the platform needs from a payment provider (we bill workspaces; this is not a tenant connector). */
export interface ProviderEvent {
  provider: string; eventId: string;
  kind: 'activated' | 'charged' | 'past_due' | 'cancelled' | 'completed' | 'updated' | 'resumed' | 'other';
  providerSubscriptionId?: string; tenantId?: string; plan?: PlanKey; seats?: number; periodEnd?: Date;
}
export interface PaymentProvider {
  id: string;
  createSubscription(i: { plan: PlanKey; seats: number; tenantId: string; email: string }): Promise<{ providerSubscriptionId: string; url: string }>;
  cancel(providerSubscriptionId: string, atCycleEnd: boolean): Promise<void>;
  updateSeats(providerSubscriptionId: string, seats: number): Promise<void>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  eventId(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): string;
  parseEvent(payload: any): ProviderEvent | null;
}

export interface RazorpayEnv { keyId: string; keySecret: string; webhookSecret: string; planIds: Partial<Record<PlanKey, string>>; fetch?: FetchLike }
const hdr = (h: Record<string, string | string[] | undefined>, n: string) => { const v = h[n]; return Array.isArray(v) ? v[0] : v; };

/**
 * Razorpay Subscriptions (India). Customers pay on Razorpay's hosted page (`short_url`); we only learn the outcome from signed webhooks.
 * Shapes follow Razorpay's public docs (create subscription, cancel with cancel_at_cycle_end, update quantity at cycle end, webhook HMAC-SHA256
 * over the raw body in X-Razorpay-Signature, event id in X-Razorpay-Event-Id). NOT verified against a live account.
 */
export function createRazorpay(env: RazorpayEnv): PaymentProvider {
  const http = createHttp({ allowedHosts: ['api.razorpay.com'], fetch: env.fetch, timeoutMs: 15_000, retries: 0 });
  const auth = { authorization: `Basic ${Buffer.from(`${env.keyId}:${env.keySecret}`).toString('base64')}`, 'content-type': 'application/json' };
  const planByRzp = new Map(Object.entries(env.planIds).map(([k, v]) => [v as string, k as PlanKey]));
  const call = async <T>(path: string, method: string, body: unknown): Promise<T> => {
    try { return await http.json<T>(`https://api.razorpay.com/v1${path}`, { method, headers: auth, body: JSON.stringify(body) }); }
    catch (e) { if (e instanceof HttpError && e.status >= 400 && e.status < 500) throw new Error(`Razorpay refused the request: ${String((e.body as any)?.error?.description ?? e.message).slice(0, 200)}`); throw e; }
  };
  return {
    id: 'razorpay',
    async createSubscription(i) {
      const planId = env.planIds[i.plan]; if (!planId) throw new Error(`No Razorpay plan id configured for ${i.plan}`);
      const r = await call<{ id: string; short_url: string }>('/subscriptions', 'POST', { plan_id: planId, total_count: 120, quantity: i.seats, customer_notify: 1, notes: { tenant_id: i.tenantId, plan: i.plan, email: i.email } });
      if (!r.id || !r.short_url) throw new Error('Razorpay returned no payment link');
      return { providerSubscriptionId: r.id, url: r.short_url };
    },
    async cancel(id, atCycleEnd) { await call(`/subscriptions/${encodeURIComponent(id)}/cancel`, 'POST', { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }); },
    async updateSeats(id, seats) { await call(`/subscriptions/${encodeURIComponent(id)}`, 'PATCH', { quantity: seats, schedule_change_at: 'cycle_end' }); },
    verifyWebhook(raw, headers) {
      const given = hdr(headers, 'x-razorpay-signature'); if (!given || !env.webhookSecret) return false;
      const want = Buffer.from(createHmac('sha256', env.webhookSecret).update(raw).digest('hex')), got = Buffer.from(given);
      return want.length === got.length && timingSafeEqual(want, got);
    },
    eventId: (raw, headers) => hdr(headers, 'x-razorpay-event-id') || createHash('sha256').update(raw).digest('hex'),
    parseEvent(p) {
      const type = String(p?.event ?? ''); const sub = p?.payload?.subscription?.entity; if (!type.startsWith('subscription.') && type !== 'payment.failed') return null;
      const kinds: Record<string, ProviderEvent['kind']> = { 'subscription.activated': 'activated', 'subscription.charged': 'charged', 'subscription.resumed': 'resumed', 'subscription.pending': 'past_due', 'subscription.halted': 'past_due', 'subscription.cancelled': 'cancelled', 'subscription.completed': 'completed', 'subscription.updated': 'updated', 'payment.failed': 'past_due' };
      const subId = sub?.id ?? p?.payload?.payment?.entity?.subscription_id ?? p?.payload?.payment?.entity?.notes?.subscription_id;
      return {
        provider: 'razorpay', eventId: String(p?.id ?? ''), kind: kinds[type] ?? 'other', providerSubscriptionId: subId, tenantId: sub?.notes?.tenant_id ?? p?.payload?.payment?.entity?.notes?.tenant_id,
        plan: sub?.plan_id ? planByRzp.get(sub.plan_id) : undefined, seats: typeof sub?.quantity === 'number' ? sub.quantity : undefined, periodEnd: sub?.current_end ? new Date(Number(sub.current_end) * 1000) : undefined,
      };
    },
  };
}
export function paymentProviderFromEnv(env: NodeJS.ProcessEnv = process.env, fetch?: FetchLike): PaymentProvider | undefined {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return undefined;
  return createRazorpay({ keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '', fetch, planIds: { starter: env.RAZORPAY_PLAN_STARTER, growth: env.RAZORPAY_PLAN_GROWTH, scale: env.RAZORPAY_PLAN_SCALE } });
}
