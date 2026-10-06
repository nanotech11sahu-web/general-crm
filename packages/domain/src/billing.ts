import { requireTenantId, runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DomainError } from './errors';
import { DbNotifier } from './integrity';
import { loadPlans, PAST_DUE_GRACE_DAYS, TRIAL_DAYS, type Plan, type PlanKey } from './plans';
import type { PaymentProvider, ProviderEvent } from './payments';
import { amountInWords, financialYear, formatInvoiceNumber, GST_STATE_CODES, splitGst, validateGstin } from './gst';

const DAY = 86_400_000;
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';
export interface Entitlements {
  status: SubStatus; plan: PlanKey; planName: string; seats: number; restricted: boolean;
  /** Why writes are blocked, in words a customer can act on. */
  reason: string | null; limits: Plan['limits']; trialEndsAt: Date | null; trialDaysLeft: number | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean;
}

export interface BillingProfile { legalName: string; gstin?: string; addressLine: string; city: string; state: string; stateCode: string; postalCode: string; email: string }
export interface Supplier { name: string; gstin: string; address: string; stateCode: string; sac: string; invoicePrefix: string; gstRatePct: number }
/** The legal entity that sells LeadDesk. Without these, payments produce a plain receipt instead of a GST tax invoice. */
export function supplierFromEnv(env: NodeJS.ProcessEnv = process.env): Supplier | null {
  if (!env.SUPPLIER_NAME || !env.SUPPLIER_GSTIN || !env.SUPPLIER_ADDRESS) return null;
  const g = validateGstin(env.SUPPLIER_GSTIN); if (!g.ok) return null;
  return { name: env.SUPPLIER_NAME, gstin: env.SUPPLIER_GSTIN.trim().toUpperCase(), address: env.SUPPLIER_ADDRESS, stateCode: g.stateCode, sac: env.SUPPLIER_SAC ?? '', invoicePrefix: (env.INVOICE_PREFIX ?? 'LD').replace(/[^A-Z0-9-]/gi, '').slice(0, 8) || 'LD', gstRatePct: Number(env.GST_RATE ?? 18) };
}

/** Subscription state, entitlements and plan enforcement for the current workspace. */
export class BillingService {
  private readonly plans: Record<PlanKey, Plan>;
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly provider?: PaymentProvider, plans = loadPlans(), private readonly sys?: SystemOps) { this.plans = plans; }
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

  // ---------- billing profile + invoices ----------
  async profile(): Promise<BillingProfile | null> { const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec(); return t?.billingProfile ?? null; }
  async setProfile(p: Partial<BillingProfile>): Promise<BillingProfile> {
    const errors: Record<string, string> = {}; const cur = (await this.profile()) ?? ({} as Partial<BillingProfile>); const m = { ...cur, ...p } as BillingProfile;
    const need = (k: keyof BillingProfile, label: string, max = 200) => { const v = String(m[k] ?? '').trim(); if (!v) errors[k] = `${label} is required`; else if (v.length > max) errors[k] = `${label} is too long`; };
    need('legalName', 'Legal name', 120); need('addressLine', 'Address', 200); need('city', 'City', 80); need('postalCode', 'PIN code', 10); need('email', 'Billing email', 120);
    if (m.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email)) errors.email = 'Enter a valid email';
    if (m.postalCode && !/^\d{6}$/.test(String(m.postalCode).trim())) errors.postalCode = 'A PIN code has 6 digits';
    let stateCode = String(m.stateCode ?? '').padStart(2, '0');
    if (m.gstin) {
      const g = validateGstin(m.gstin);
      if (!g.ok) errors.gstin = g.reason; else { if (stateCode && stateCode !== '00' && stateCode !== g.stateCode) errors.stateCode = `The GSTIN is registered in ${GST_STATE_CODES[g.stateCode]}; choose the same state`; stateCode = g.stateCode; m.gstin = m.gstin.trim().toUpperCase(); }
    }
    if (!GST_STATE_CODES[stateCode]) errors.stateCode = 'Choose a state';
    if (Object.keys(errors).length) throw new DomainError('invalid_billing_profile', 'Some billing details need attention', errors);
    const clean: BillingProfile = { legalName: m.legalName.trim(), gstin: m.gstin || undefined, addressLine: m.addressLine.trim(), city: m.city.trim(), state: GST_STATE_CODES[stateCode], stateCode, postalCode: String(m.postalCode).trim(), email: m.email.trim() };
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { billingProfile: clean } });
    await this.r.audit.record({ action: 'billing.profile_updated', entity: 'tenant', meta: { gstin: !!clean.gstin } });
    return clean;
  }

  /** Issues the invoice for one provider payment, once (unique payment id). Without supplier details it records a receipt, honestly labelled. */
  async issueInvoice(pay: NonNullable<ProviderEvent['payment']>, ctx: { plan: PlanKey; seats: number; periodEnd?: Date }) {
    const existing = await this.r.invoices.findOne({ paymentId: pay.paymentId }); if (existing) return existing;
    if (pay.currency !== 'INR') return null; // GST invoices are INR only; other currencies are not sold
    const supplier = supplierFromEnv(); const prof = await this.profile(); const now = this.now();
    const fy = financialYear(pay.paidAt ?? now);
    const base: Record<string, unknown> = { paymentId: pay.paymentId, issuedAt: pay.paidAt ?? now, plan: ctx.plan, planName: this.plans[ctx.plan]?.name ?? ctx.plan, seats: ctx.seats, periodEnd: ctx.periodEnd, currency: 'INR', fy, grossPaise: pay.amountPaise,
      customer: prof ?? { legalName: ((await this.db.models.Tenant.findById(requireTenantId(), { name: 1 }).lean().exec()) as any)?.name ?? 'Customer' } };
    let doc: Record<string, unknown>;
    if (supplier && this.sys) {
      const pos = prof?.stateCode ?? supplier.stateCode; const g = splitGst(pay.amountPaise, supplier.gstRatePct, supplier.stateCode, pos);
      const seq = await this.sys.nextInvoiceSeq(fy);
      doc = { ...base, kind: 'tax_invoice', number: formatInvoiceNumber(supplier.invoicePrefix, fy, seq), taxablePaise: g.taxablePaise, ratePct: g.ratePct, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: g.igstPaise, intraState: g.intraState, placeOfSupply: pos, supplier };
    } else {
      doc = { ...base, kind: 'receipt', number: `RCPT-${pay.paymentId.slice(-10).toUpperCase()}` };
    }
    try { return await this.r.invoices.create(doc); } catch (e: any) { if (e?.code === 11000) return this.r.invoices.findOne({ paymentId: pay.paymentId }); throw e; }
  }
  async invoices() { return this.r.invoices.find({}, { sort: { issuedAt: -1 }, limit: 200 }); }
  async invoice(id: string) {
    const inv: any = await this.r.invoices.findById(id); if (!inv) throw new DomainError('not_found', 'Invoice not found', undefined, 404);
    return { ...inv.toObject?.() ?? inv, amountInWords: amountInWords(inv.grossPaise), supplierStateName: inv.supplier ? GST_STATE_CODES[inv.supplier.stateCode] : null, placeOfSupplyName: inv.placeOfSupply ? GST_STATE_CODES[inv.placeOfSupply] : null };
  }

  // ---------- plan / seat changes with proration quote ----------
  /**
   * What changing to `plan` x `seats` would cost *today*. Prices are per seat per month and GST-inclusive as charged by the provider;
   * the provider computes the real prorated amount, this is the estimate shown before the customer confirms.
   */
  async quote(i: { plan?: string; seats?: number }) {
    const sub: any = await this.ensureTrial(); const e = BillingService.effective(sub, this.plans, this.now());
    if (e.status !== 'active' || e.plan === 'trial') throw new DomainError('not_subscribed', 'Quotes are for paid plans', undefined, 409);
    const next = i.plan ? this.planOf(i.plan) : this.plans[e.plan]; const seats = i.seats ?? e.seats;
    const oldMonthly = this.plans[e.plan].pricePerSeatInr * e.seats, newMonthly = next.pricePerSeatInr * seats; const delta = newMonthly - oldMonthly;
    const end = e.currentPeriodEnd; const left = end ? Math.max(0, Math.min(1, (end.getTime() - this.now().getTime()) / (30 * DAY))) : 1;
    const upgrade = delta > 0;
    return { plan: next.key, seats, monthlyInr: newMonthly, previousMonthlyInr: oldMonthly, effective: upgrade ? 'now' as const : 'cycle_end' as const, chargeNowInr: upgrade ? Math.round(delta * left) : 0, fractionOfPeriodLeft: Math.round(left * 100) / 100, note: upgrade ? 'Estimate. Your provider charges the exact prorated difference now, then the new amount each month.' : 'A reduction takes effect at your next renewal; nothing is refunded for the current period.' };
  }
  async changePlan(i: { plan: string; seats?: number }) {
    const sub: any = await this.ensureTrial(); const e = BillingService.effective(sub, this.plans, this.now());
    if (e.status !== 'active' || e.plan === 'trial') throw new DomainError('not_subscribed', 'Choose a plan first', undefined, 409);
    const next = this.planOf(i.plan); const seats = i.seats ?? e.seats; const used = (await this.seatsUsed()).used;
    if (next.key === e.plan && seats === e.seats) throw new DomainError('no_change', 'That is already your plan', undefined, 409);
    if (!Number.isInteger(seats) || seats < Math.max(1, used) || seats > next.limits.maxSeats) throw new DomainError('invalid_seats', `${next.name} allows ${Math.max(1, used)} to ${next.limits.maxSeats} seats with your current team`, { min: Math.max(1, used), max: next.limits.maxSeats });
    const conns = await this.r.connections.count({ status: { $ne: 'revoked' } });
    if (conns > next.limits.connections) throw new DomainError('plan_limit', `${next.name} includes ${next.limits.connections} connections and you have ${conns}. Remove some first.`, { feature: 'connections' }, 409);
    const q = await this.quote({ plan: next.key, seats });
    if (sub.provider === 'razorpay') { if (!this.provider) throw new DomainError('payments_unavailable', 'Online payments are not configured', undefined, 409); await this.provider.changePlan(sub.providerSubscriptionId, next.key, seats, q.effective); }
    if (q.effective === 'now') await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { plan: next.key, seats, scheduledChange: null } });
    else await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { scheduledChange: { plan: next.key, seats, at: e.currentPeriodEnd } } });
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { plan: q.effective === 'now' ? next.key : sub.plan } });
    await this.r.audit.record({ action: 'billing.plan_changed', entity: 'subscription', meta: { from: e.plan, to: next.key, seats, effective: q.effective } });
    return { ...(await this.overview()), quote: q };
  }

  async changeSeats(seats: number) {
    const sub: any = await this.ensureTrial(); const e = BillingService.effective(sub, this.plans, this.now());
    if (e.status !== 'active' || e.plan === 'trial') throw new DomainError('not_subscribed', 'Seats can be changed once you have a paid plan', undefined, 409);
    const used = (await this.seatsUsed()).used; const max = this.plans[e.plan].limits.maxSeats;
    if (!Number.isInteger(seats) || seats < Math.max(1, used) || seats > max) throw new DomainError('invalid_seats', `Seats must be between ${Math.max(1, used)} and ${max}`, { min: Math.max(1, used), max });
    if (sub.provider === 'razorpay') { if (!this.provider) throw new DomainError('payments_unavailable', 'Online payments are not configured', undefined, 409); await this.provider.updateSeats(sub.providerSubscriptionId, seats, seats > sub.seats ? 'now' : 'cycle_end'); }
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: { seats } }); // more seats are usable at once (the provider bills the prorated difference now); fewer are billed from the next cycle
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
        if (e.kind === 'charged') set.scheduledChange = null;
        break;
      case 'past_due': Object.assign(set, { status: 'past_due', pastDueSince: sub.pastDueSince ?? this.now() }); break;
      case 'cancelled': Object.assign(set, { status: 'canceled', cancelAtPeriodEnd: true }); if (e.periodEnd) set.currentPeriodEnd = e.periodEnd; break;
      case 'completed': Object.assign(set, { status: 'expired' }); break;
      case 'updated': if (e.seats) set.seats = e.seats; if (e.periodEnd) set.currentPeriodEnd = e.periodEnd; break;
      default: return 'ignored';
    }
    await this.r.subscriptions.updateOne({ _id: sub._id }, { $set: set });
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { plan: (set.plan as string) ?? sub.plan } });
    if (e.kind === 'charged' && e.payment) await this.issueInvoice(e.payment, { plan: ((set.plan as PlanKey) ?? sub.plan) as PlanKey, seats: (set.seats as number) ?? sub.seats, periodEnd: (set.currentPeriodEnd as Date | undefined) });
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
    if (e.status === 'past_due') {
      // dunning: on the day it failed and again on days 1, 3, 5 and 7 (the last day of grace), not every day
      const sub: any = await this.r.subscriptions.findOne({}); const since = sub?.pastDueSince ? new Date(sub.pastDueSince).getTime() : this.now().getTime();
      const day = Math.floor((this.now().getTime() - since) / DAY); const left = Math.max(0, PAST_DUE_GRACE_DAYS - day);
      if ([0, 1, 3, 5, 7].includes(day)) await say(`past-due-d${day}`, 'past_due', left > 0 ? `Your last payment failed. Update your payment method within ${left} day${left === 1 ? '' : 's'} to avoid the workspace becoming read-only.` : 'Your last payment failed and today is the last day before the workspace becomes read-only. Update your payment method now.');
    }
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
      const out = await runWithTenant(String(tenantId), () => new BillingService(db, now, provider, undefined, sys).applyProviderEvent(parsed));
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
