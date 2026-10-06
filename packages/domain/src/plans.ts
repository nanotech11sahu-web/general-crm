/**
 * Plan catalogue. **Prices and limits are placeholders** for the owner to set before launch (override with PLANS_JSON, see decisions #95).
 * Clients pay messaging/telephony providers directly, so no plan resells or meters those.
 */
export type PlanKey = 'trial' | 'starter' | 'growth' | 'scale';
export interface PlanLimits {
  /** Most seats a workspace on this plan may have. */
  maxSeats: number;
  connections: number;
  ai: boolean;
  cloudTelephony: boolean;
  /** Soft cap: crossing it shows a nudge; **intake is never blocked** (a lost lead is worse than an unpaid overage). null = unlimited. */
  leadsPerMonth: number | null;
}
export interface Plan { key: PlanKey; name: string; pricePerSeatInr: number; purchasable: boolean; limits: PlanLimits; blurb: string }

const BASE: Record<PlanKey, Plan> = {
  trial: { key: 'trial', name: 'Free trial', pricePerSeatInr: 0, purchasable: false, blurb: '14 days, everything unlocked, up to 5 seats', limits: { maxSeats: 5, connections: 10, ai: true, cloudTelephony: true, leadsPerMonth: null } },
  starter: { key: 'starter', name: 'Starter', pricePerSeatInr: 699, purchasable: true, blurb: 'Lead capture, Today, WhatsApp/SMS, Pulse', limits: { maxSeats: 10, connections: 3, ai: false, cloudTelephony: false, leadsPerMonth: 2000 } },
  growth: { key: 'growth', name: 'Growth', pricePerSeatInr: 1299, purchasable: true, blurb: 'Adds cloud calling with recordings and AI assistance', limits: { maxSeats: 50, connections: 10, ai: true, cloudTelephony: true, leadsPerMonth: 20000 } },
  scale: { key: 'scale', name: 'Scale', pricePerSeatInr: 1999, purchasable: true, blurb: 'Large teams, high volume, priority support', limits: { maxSeats: 500, connections: 50, ai: true, cloudTelephony: true, leadsPerMonth: null } },
};

export const TRIAL_DAYS = 14;
export const PAST_DUE_GRACE_DAYS = 7;

/** `PLANS_JSON='{"starter":{"pricePerSeatInr":499}}'` patches prices/limits per environment without a deploy of code. */
export function loadPlans(env: NodeJS.ProcessEnv = process.env): Record<PlanKey, Plan> {
  const out = JSON.parse(JSON.stringify(BASE)) as Record<PlanKey, Plan>;
  if (env.PLANS_JSON) {
    const o = JSON.parse(env.PLANS_JSON) as Partial<Record<PlanKey, Partial<Plan> & { limits?: Partial<PlanLimits> }>>;
    for (const k of Object.keys(o) as PlanKey[]) if (out[k]) { const { limits, ...rest } = o[k]!; Object.assign(out[k], rest); Object.assign(out[k].limits, limits ?? {}); out[k].key = k; }
  }
  return out;
}
export const publicPlans = (plans = loadPlans()) => (Object.values(plans) as Plan[]).filter((p) => p.purchasable).map((p) => ({ key: p.key, name: p.name, pricePerSeatInr: p.pricePerSeatInr, blurb: p.blurb, limits: p.limits }));
