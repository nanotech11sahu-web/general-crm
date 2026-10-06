import { requireTenantId, runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DomainError } from './errors';
import { DbNotifier } from './integrity';
import { loadPlans, PAST_DUE_GRACE_DAYS, TRIAL_DAYS, type Plan, type PlanKey } from './plans';
import type { PaymentProvider, ProviderEvent } from './payments';

const DAY = 86_400_000;
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export interface Entitlements {
  status: SubStatus; plan: PlanKey; planName: string; seats: number; restricted: boolean;
  /** Why writes are blocked, in words a customer can act on. */
  reason: string | null; limits: Plan['limits']; trialEndsAt: Date | null; trialDaysLeft: number | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
}

/** Subscription state, entitlements and plan enforcement for the current workspace. */
export class BillingService {
  private readonly plans: Record<PlanKey, Plan>;
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly provider?: PaymentProvider, plans = loadPlans()) { this.plans = plans; }
  private get r() { return this.db.repos; }

  /** Every workspace has exactly one subscription; legacy workspaces (created before billing) start a fresh trial on first read. */
  async ensureTrial(): Promise<any> {
    const have = await this.r.subscriptions.findOne({});
    if (have) return have;
    try {
      return await this.r.subscriptions.create({ plan: 'trial', seats: this.plans.trial.limits.maxSeats, status: 'trialing', trialEndsAt: new Date(this.now().getTime() + TRIAL_DAYS * DAY) });
    } catch (e: any) { if (e?.code === 11000) return this.r.subscriptions.findOne({}); throw e; }
  }

  /** Pure view of the subscription at `now`: statuses roll forward lazily (trial ends, cancelled period ends, past-due grace ends). */
  static effective(sub: any, plans: Record<PlanKey, Plan>, now: Date): Entitlements {
    let status: SubStatus = sub.status; let reason: string | null = null; let restricted = false;
    const trialEnds = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null; const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    if (status === 'trialing' && trialEnds && now >= trialEnds) status = 'expired';
    if ((status === 'canceled' || status === 'active') && periodEnd && sub.cancelAtPeriodEnd && now >= periodEnd) status = 'expired';
    if (status === 'canceled' && periodEnd && now >= periodEnd) status = 'expired';
    if (status === 'expired') { restricted = true; reason = sub.plan === 'trial' ? 'Your free trial has ended. Choose a plan to keep working; your data is safe.' : 'Your subscription has ended. Renew to keep working; your data is safe.'; }
    if (status === 'past_due' && sub.pastDueSince && now.getTime() >= new Date(sub.pastDueSince).getTime() + PAST_DUE_GRACE_DAYS * DAY) { restricted = true; reason = 'Your last payment failed and the grace period has ended. Update your payment to continue.'; }
    const plan = plans[sub.plan as PlanKey] ?? plans.trial;
    return {
      status, plan: plan.key, planName: plan.name, seats: sub.seats, restricted, reason, limits: plan.limits, trialEndsAt: trialEnds, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
      trialDaysLeft: status === 'trialing' && trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / DAY)) : null,
    };
  }
  async entitlements(): Promise<Entitlements> { return BillingService.effective(await this.ensureTrial(), this.plans, this.now()); }
  async restricted() { return (await this.entitlements()).restricted; }

  // ---------- enforcement ----------
  /** Seats = active members + invitations still open, so a team cannot exceed its plan by inviting in bulk. */
  async seatsUsed() {
    const [m, i] = await Promise.all([this.r.memberships.count({ status: 'active' }), this.r.invitations.count({ acceptedAt: null, expiresAt: { $gt: this.now() } })]);
    return { members: m, pendingInvites: i, used: m + i };
  }
  async assertSeatAvailable() {
    const e = await this.entitlements(); const s = await this.seatsUsed();
    if (s.used >= Math.min(e.seats, e.limits.maxSeats)) throw new DomainError('seat_limit', `Your plan includes ${e.seats} seat${e.seats === 1 ? '' : 's'} and all are in use. Add seats in Billing to invite more people.`, { seats: e.seats, used: s.used }, 402);
  }
  async assertCanConnect(category: string) {
    const e = await this.entitlements();
    if (category === 'voice' && !e.limits.cloudTelephony) throw new DomainError('plan_limit', `Cloud calling is not part of the ${e.planName} plan. Upgrade to connect a telephony provider.`, { feature: 'cloudTelephony' }, 402);
    if (category === 'ai' && !e.limits.ai) throw new DomainError('plan_limit', `AI is not part of the ${e.planName} plan. Upgrade to use it.`, { feature: 'ai' }, 402);
    const n = await this.r.connections.count({ status: { $ne: 'revoked' } });
    if (n >= e.limits.connections) throw new DomainError('plan_limit', `The ${e.planName} plan includes ${e.limits.connections} connections. Upgrade for more.`, { feature: 'connections', limit: e.limits.connections }, 402);
  }
  async assertFeature(f: 'ai' | 'cloudTelephony') {
    const e = await this.entitlements();
    if (!e.limits[f]) throw new DomainError('plan_limit', `${f === 'ai' ? 'AI' : 'Cloud calling'} is not part of the ${e.planName} plan. Upgrade to use it.`, { feature: f }, 402);
  }

  async usage() {
    const e = await this.entitlements(); const s = await this.seatsUsed(); const start = new Date(Date.UTC(this.now().getUTCFullYear(), this.now().getUTCMonth(), 1));
    const [leads, messages, ai] = await Promise.all([this.r.leads.count({ createdAt: { $gte: start } }), this.r.messages.count({ direction: 'out', createdAt: { $gte: start } }), this.r.aiUsage.find({ day: { $gte: start.toISOString().slice(0, 10) } })]);
    const cap = e.limits.leadsPerMonth;
    return { month: start.toISOString().slice(0, 7), seats: { used: s.used, members: s.members, pendingInvites: s.pendingInvites, limit: Math.min(e.seats, e.limits.maxSeats) }, leads: { created: leads, softLimit: cap, nearLimit: cap !== null && leads >= cap * 0.8, overLimit: cap !== null && leads > cap }, messagesSent: messages, aiRequests: (ai as any[]).reduce((a, x) => a + x.requests, 0), connections: { used: await this.r.connections.count({ status: { $ne: 'revoked' } }), limit: e.limits.connections } };
  }

  async overview() {
    const sub: any = await this.ensureTrial(); const e = BillingService.effective(sub, this.plans, this.now());
    return { ...e, provider: sub.provider ?? null, pending: sub.pending ? { plan: sub.pending.plan, seats: sub.pending.seats, url: sub.pending.url } : null, paymentsEnabled: !!this.provider, plans: (Object.values(this.plans) as Plan[]).filter((p) => p.purchasable).map((p) => ({ key: p.key, name: p.name, pricePerSeatInr: p.pricePerSeatInr, blurb: p.blurb, limits: p.limits })) };
  }

  // ---------- changes (checkout, seats, cancel) ----------
  private planOf(key: string): Plan { const p = this.plans[key as PlanKey]; if (!p || !p.purchasable) throw new DomainError('unknown_plan', 'Choose one of the listed plans'); return p; }
  async checkout(i: { plan: string; seats: number; email: string }) {
    if (!this.provider) throw new DomainError('payments_unavailable', 'Online payments are not set up on this installation. Contact support to activate a plan.', undefined, 409);
    const plan = this.planOf(i.plan); const used = (await this.seatsUsed()).used;
    if (!Number.isInteger(i.seats) || i.seats < Math.max(1, used) || i.seats > plan.limits.maxSeats) throw new DomainError('invalid_seats', `Seats must be between ${Math.max(1, used)} (people already on the team) and ${plan.limits.maxSeats} for ${plan.name}`, { min: Math.max(1, used), max: plan.limits.maxSeats });
    const sub = await this.ensureTrial();
    if (sub.status === 'active' && sub.providerSubscriptionId) throw new DomainError('already_subscribed', 'This workspace already has a subscription. Change the plan by contacting support, or adjust seats.', undefined, 409);
    const c = await this.provider.createSubscription({ plan: plan.key, seats: i.seats, tenantId: requireTenantId(), email: i.email });
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { provider: this.provider.id, pending: { plan: plan.key, seats: i.seats, providerSubscriptionId: c.providerSubscriptionId, url: c.url, createdAt: this.now() }, providerSubscriptionId: c.providerSubscriptionId } });
    await this.r.audit.record({ action: 'billing.checkout_started', entity: 'subscription', meta: { plan: plan.key, seats: i.seats } });
    return { url: c.url };
  }
  async changeSeats(seats: number) {
    const sub: any = await this.ensureTrial(); const e = BillingService.effective(sub, this.plans, this.now());
    if (e.status !== 'active' || e.plan === 'trial') throw new DomainError('not_subscribed', 'Seats can be changed once you have a paid plan', undefined, 409);
    const used = (await this.seatsUsed()).used; const max = this.plans[e.plan].limits.maxSeats;
    if (!Number.isInteger(seats) || seats < Math.max(1, used) || seats > max) throw new DomainError('invalid_seats', `Seats must be between ${Math.max(1, used)} and ${max}`, { min: Math.max(1, used), max });
    if (sub.provider === 'razorpay') { if (!this.provider) throw new DomainError('payments_unavailable', 'Online payments are not configured', undefined, 409); await this.provider.updateSeats(sub.providerSubscriptionId, seats); }
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { seats } }); // takes effect now; the provider bills the new quantity from the next cycle
    await this.r.audit.record({ action: 'billing.seats_changed', entity: 'subscription', meta: { from: sub.seats, to: seats } });
    return this.overview();
  }
  async cancel() {
    const sub: any = await this.ensureTrial();
    if (BillingService.effective(sub, this.plans, this.now()).status !== 'active') throw new DomainError('not_subscribed', 'There is no active subscription to cancel', undefined, 409);
    if (sub.provider === 'razorpay' && this.provider) await this.provider.cancel(sub.providerSubscriptionId, true);
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { cancelAtPeriodEnd: true } });
    await this.r.audit.record({ action: 'billing.cancel_requested', entity: 'subscription' });
    return this.overview();
  }

  // ---------- provider events and operator overrides ----------
  /** Idempotent: events carry absolute state (status, period end, quantity), so replays and reordering converge. */
  async applyProviderEvent(e: ProviderEvent): Promise<'applied' | 'ignored'> {
    const sub: any = await this.ensureTrial();
    if (sub.providerSubscriptionId && e.providerSubscriptionId && sub.providerSubscriptionId !== e.providerSubscriptionId && !(sub.pending && sub.pending.providerSubscriptionId === e.providerSubscriptionId)) return 'ignored'; // an old/abandoned subscription
    const set: Record<string, unknown> = {}; const planKey: PlanKey | undefined = e.plan ?? (sub.pending?.plan as PlanKey | undefined);
    switch (e.kind) {
      case 'activated': case 'charged': case 'resumed':
        Object.assign(set, { status: 'active', pastDueSince: null, cancelAtPeriodEnd: false, provider: e.provider, providerSubscriptionId: e.providerSubscriptionId, pending: null });
        if (planKey && this.plans[planKey]?.purchasable) set.plan = planKey;
        if (e.seats) set.seats = e.seats; if (e.periodEnd) set.currentPeriodEnd = e.periodEnd;
        break;
      case 'past_due': Object.assign(set, { status: 'past_due', pastDueSince: sub.pastDueSince ?? this.now() }); break;
      case 'cancelled': Object.assign(set, { status: 'canceled', cancelAtPeriodEnd: true }); if (e.periodEnd) set.currentPeriodEnd = e.periodEnd; break;
      case 'completed': Object.assign(set, { status: 'expired' }); break;
      case 'updated': if (e.seats) set.seats = e.seats; if (e.periodEnd) set.currentPeriodEnd = e.periodEnd; break;
      default: return 'ignored';
    }
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: set });
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { plan: (set.plan as string) ?? sub.plan } });
    await this.r.audit.record({ action: `billing.${e.kind}`, entity: 'subscription', meta: { provider: e.provider, plan: set.plan ?? sub.plan, seats: set.seats ?? sub.seats } });
    return 'applied';
  }

  /** Support/operator override (invoice customers, goodwill extensions). */
  async setManual(i: { plan: PlanKey; seats: number; periodEnd?: Date | null; note?: string }) {
    const sub: any = await this.ensureTrial();
    if (!this.plans[i.plan]) throw new DomainError('unknown_plan', 'Unknown plan');
    if (i.plan !== 'trial' && (i.seats < 1 || i.seats > this.plans[i.plan].limits.maxSeats)) throw new DomainError('invalid_seats', `Seats must be 1 to ${this.plans[i.plan].limits.maxSeats}`);
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { plan: i.plan, seats: i.seats, status: i.plan === 'trial' ? 'trialing' : 'active', provider: 'manual', cancelAtPeriodEnd: false, pastDueSince: null, pending: null, currentPeriodEnd: i.periodEnd ?? null, note: i.note ?? null } });
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { plan: i.plan } });
    return this.overview();
  }
  async extendTrial(days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 60) throw new DomainError('invalid_days', 'Extend by 1 to 60 days');
    const sub: any = await this.ensureTrial();
    const base = Math.max(this.now().getTime(), sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0);
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { status: 'trialing', plan: 'trial', seats: Math.max(sub.seats, this.plans.trial.limits.maxSeats), trialEndsAt: new Date(base + days * DAY) } });
    return this.overview();
  }

  /** Nudges admins at the moments that matter, once each (dedupe keys): trial ending in 3 days / 1 day, trial or subscription ended, payment failing. */
  async remind(): Promise<string[]> {
    const e = await this.entitlements(); const n = new DbNotifier(this.db); const sent: string[] = [];
    const say = async (key: string, kind: string, text: string) => { await n.notify({ kind: `billing.${kind}`, audience: 'admins', payload: { text, status: e.status, daysLeft: e.trialDaysLeft }, dedupeKey: `billing:${key}` }); sent.push(key); };
    if (e.status === 'trialing' && e.trialDaysLeft !== null && e.trialDaysLeft <= 3) await say(`trial-${e.trialDaysLeft <= 1 ? '1d' : '3d'}`, 'trial_ending', e.trialDaysLeft <= 1 ? 'Your free trial ends within a day. Choose a plan to keep working.' : `Your free trial ends in ${e.trialDaysLeft} days. Choose a plan to keep working.`);
    if (e.status === 'expired') await say(`expired-${(e.trialEndsAt ?? e.currentPeriodEnd)?.toISOString().slice(0, 10) ?? 'x'}`, 'expired', e.reason ?? 'Your workspace is read-only until a plan is active.');
    if (e.status === 'past_due') await say(`past-due-${new Date(this.now().getTime()).toISOString().slice(0, 10)}`, 'past_due', 'Your last payment failed. Update your payment method to avoid interruption.');
    return sent;
  }

  /** Worker: retry billing events whose first processing failed (e.g. the database blinked while the provider got its 200). */
  static async retryEvents(db: TenantDb, sys: SystemOps, provider: PaymentProvider | undefined, now: () => Date = () => new Date()) {
    let done = 0;
    for (const ev of (await sys.pendingBillingEvents(25)) as any[]) done += (await BillingService.processEvent(db, sys, provider, ev, now)) ? 1 : 0;
    return { done };
  }
  /** Resolves the tenant (event notes, else our stored provider subscription id), applies the event under that tenant, records the outcome. */
  static async processEvent(db: TenantDb, sys: SystemOps, provider: PaymentProvider | undefined, ev: any, now: () => Date = () => new Date()): Promise<boolean> {
    try {
      const parsed: ProviderEvent | null = provider?.parseEvent(ev.payload) ?? null;
      if (!parsed) { await sys.finishBillingEvent(ev._id, 'ignored'); return true; }
      const tenantId = parsed.tenantId ?? (parsed.providerSubscriptionId ? await sys.tenantByProviderSubscription(parsed.providerSubscriptionId) : null);
      if (!tenantId) { await sys.finishBillingEvent(ev._id, 'ignored', 'no tenant for event'); return true; }
      const out = await runWithTenant(String(tenantId), () => new BillingService(db, now, provider).applyProviderEvent(parsed));
      await sys.finishBillingEvent(ev._id, out === 'applied' ? 'done' : 'ignored', undefined, String(tenantId));
      return true;
    } catch (e: any) { await sys.finishBillingEvent(ev._id, 'failed', String(e?.message ?? e).slice(0, 300)); return false; }
  }

  /** Worker (every minute): retry unprocessed provider events, and (once an hour) send trial/payment reminders. */
  static async sweepAll(db: TenantDb, sys: SystemOps, provider: PaymentProvider | undefined, o: { now?: () => Date; reminders?: boolean } = {}) {
    const now = o.now ?? (() => new Date()); const r = await BillingService.retryEvents(db, sys, provider, now); let reminded = 0;
    if (o.reminders) for (const t of (await sys.activeTenants()) as any[]) { try { reminded += (await runWithTenant(String(t._id), () => new BillingService(db, now, provider).remind())).length; } catch { /* next tenant */ } }
    return { ...r, reminded };
  }
}
