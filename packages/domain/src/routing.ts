import { getContext, requireTenantId, runWithTenant, toObjectId, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { DbNotifier, type Notifier } from './integrity';

export type Strategy = 'round_robin' | 'least_loaded' | 'specific_user' | 'sticky_previous_owner' | 'team_pool';
export interface RuleConditions {
  sourceKinds?: string[]; campaignContains?: string; cities?: string[]; languages?: string[];
  timeOfDay?: { from: string; to: string }; scoreMin?: number; scoreMax?: number; custom?: Record<string, string | string[]>;
}
export interface RuleAction { kind: Strategy; poolUserIds?: string[]; teamId?: string; userId?: string; requireSkills?: string[]; fallback?: 'round_robin' | 'least_loaded' }
export interface RuleInput { name: string; conditions?: RuleConditions; action: RuleAction; active?: boolean }

const STRATEGIES: Strategy[] = ['round_robin', 'least_loaded', 'specific_user', 'sticky_previous_owner', 'team_pool'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
type Dow = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export function validateRule(r: RuleInput): void {
  const errors: Record<string, string> = {};
  if (!r.name?.trim()) errors.name = 'required';
  const a = r.action;
  if (!a || !STRATEGIES.includes(a.kind)) errors.action = `kind must be one of ${STRATEGIES.join(', ')}`;
  else {
    if (a.kind === 'specific_user' && !a.userId) errors['action.userId'] = 'required for specific_user';
    if (a.kind === 'team_pool' && !a.teamId) errors['action.teamId'] = 'required for team_pool';
  }
  const t = r.conditions?.timeOfDay;
  if (t && (!HHMM.test(t.from) || !HHMM.test(t.to))) errors['conditions.timeOfDay'] = 'use HH:MM';
  if (Object.keys(errors).length) throw new DomainError('invalid_rule', 'Invalid assignment rule', errors);
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export function localParts(d: Date, tz: string): { dow: Dow; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dow: get('weekday').toLowerCase().slice(0, 3) as any, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
export function inTimeWindow(d: Date, tz: string, from: string, to: string): boolean {
  const m = localParts(d, tz).minutes, a = minutesOf(from), b = minutesOf(to);
  return a <= b ? m >= a && m < b : m >= a || m < b; // supports windows that wrap midnight (e.g. 21:00-09:00)
}
/** `workingHours: { days: { mon: [['09:00','18:00']], ... } }`; missing config = always available. */
export function withinWorkingHours(wh: any, d: Date, tz: string): boolean {
  if (!wh?.days) return true;
  const { dow, minutes } = localParts(d, tz);
  const ranges: [string, string][] = wh.days[dow] ?? [];
  return ranges.some(([a, b]) => minutes >= minutesOf(a) && minutes < minutesOf(b));
}

export type PresenceState = 'online' | 'on_call' | 'away' | 'offline';
const PRESENCE_STALE_MS = 5 * 60_000;

export class PresenceService {
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date()) {}
  async set(userId: string, state: PresenceState) {
    await this.db.repos.presence.updateOne({ userId: toObjectId(userId) }, { $set: { state, updatedAt: this.now() } }, { upsert: true });
  }
  /** A heartbeat older than 5 minutes means the agent is gone, whatever the stored state says. */
  async get(userIds?: string[]): Promise<Record<string, PresenceState>> {
    const rows: any[] = await this.db.repos.presence.find(userIds ? { userId: { $in: userIds.map(toObjectId) } } : {});
    const out: Record<string, PresenceState> = {};
    for (const r of rows) out[String(r.userId)] = this.now().getTime() - new Date(r.updatedAt).getTime() > PRESENCE_STALE_MS ? 'offline' : r.state;
    return out;
  }
}

export interface Decision { userId: string | null; ruleId?: unknown; strategy?: string; explanation: string }

export class RoutingService {
  private readonly presence: PresenceService;
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date()) { this.presence = new PresenceService(db, now); }
  private get r() { return this.db.repos; }

  private async tenant(): Promise<any> { return this.db.models.Tenant.findById(requireTenantId()).lean().exec(); }

  async rules() { return this.r.rules.find({}, { sort: { priority: 1 } }); }

  /** Replace the ordered rule list. Validates every rule and that referenced users exist. */
  async setRules(rules: RuleInput[], def?: RuleAction | null) {
    rules.forEach(validateRule);
    const ids = new Set<string>();
    for (const r of [...rules.map((x) => x.action), ...(def ? [def] : [])]) { (r.poolUserIds ?? []).forEach((x) => ids.add(x)); if (r.userId) ids.add(r.userId); }
    if (ids.size) {
      const found = await this.r.memberships.find({ userId: { $in: [...ids].map(toObjectId) } });
      if (found.length !== ids.size) throw new DomainError('invalid_rule', 'Rule references users who are not members of this workspace');
    }
    const pick = <T extends object>(o: T | undefined, keys: string[]): any => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => keys.includes(k)));
    const COND = ['sourceKinds', 'campaignContains', 'cities', 'languages', 'timeOfDay', 'scoreMin', 'scoreMax', 'custom'];
    const ACT = ['kind', 'poolUserIds', 'teamId', 'userId', 'requireSkills', 'fallback'];
    await this.r.rules.deleteMany({});
    if (rules.length) await this.r.rules.createMany(rules.map((x, i) => ({ name: x.name.trim().slice(0, 100), priority: i + 1, conditions: pick(x.conditions, COND), action: pick(x.action, ACT), active: x.active ?? true })));
    if (def) validateRule({ name: 'default', action: def });
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, def ? { $set: { 'settings.routing.default': pick(def, ACT) } } : { $unset: { 'settings.routing.default': 1 } }).exec();
    return { rules: await this.rules(), default: def ?? null };
  }

  private ruleMatches(c: RuleConditions, lead: any, sourceKind: string | undefined, tz: string): string | null {
    const why: string[] = [];
    if (c.sourceKinds?.length) { if (!sourceKind || !c.sourceKinds.includes(sourceKind)) return null; why.push(`source=${sourceKind}`); }
    if (c.campaignContains) { if (!String(lead.campaign ?? '').toLowerCase().includes(c.campaignContains.toLowerCase())) return null; why.push(`campaign~"${c.campaignContains}"`); }
    if (c.cities?.length) { if (!c.cities.some((x) => x.toLowerCase() === String(lead.city ?? '').toLowerCase())) return null; why.push(`city=${lead.city}`); }
    if (c.languages?.length) { if (!c.languages.some((x) => x.toLowerCase() === String(lead.language ?? '').toLowerCase())) return null; why.push(`language=${lead.language}`); }
    if (c.timeOfDay) { if (!inTimeWindow(this.now(), tz, c.timeOfDay.from, c.timeOfDay.to)) return null; why.push(`time ${c.timeOfDay.from}-${c.timeOfDay.to}`); }
    if (c.scoreMin !== undefined || c.scoreMax !== undefined) {
      if (lead.score === undefined || lead.score === null) return null;
      if (c.scoreMin !== undefined && lead.score < c.scoreMin) return null;
      if (c.scoreMax !== undefined && lead.score > c.scoreMax) return null;
      why.push(`score ${lead.score}`);
    }
    for (const [k, v] of Object.entries(c.custom ?? {})) {
      const actual = String(lead.custom?.[k] ?? '').toLowerCase();
      if (!(Array.isArray(v) ? v : [v]).some((x) => String(x).toLowerCase() === actual)) return null;
      why.push(`${k}=${lead.custom?.[k]}`);
    }
    return why.length ? why.join(', ') : 'any lead';
  }

  private async openLoad(userIds: string[]): Promise<Map<string, number>> {
    const open: any[] = await this.r.statuses.find({ kind: 'open' });
    const rows: any[] = await this.r.leads.aggregate([
      { $match: { ownerId: { $in: userIds.map(toObjectId) }, deletedAt: null, $or: [{ statusId: { $in: open.map((x) => x._id) } }, { statusId: null }] } },
      { $group: { _id: '$ownerId', n: { $sum: 1 } } },
    ]);
    return new Map(userIds.map((u) => [u, rows.find((x) => String(x._id) === u)?.n ?? 0]));
  }

  /** Eligible people for an action, strictest rules first; relaxations are reported in the explanation. */
  private async candidates(action: RuleAction, lead: any, tz: string, exclude: string[]): Promise<{ users: string[]; relaxed: string | null; notes: string[] }> {
    let ms: any[] = await this.r.memberships.find({ status: 'active' });
    if (action.kind === 'specific_user') ms = ms.filter((m) => String(m.userId) === action.userId);
    else if (action.kind === 'team_pool') ms = ms.filter((m) => String(m.teamId) === action.teamId);
    else if (action.poolUserIds?.length) ms = ms.filter((m) => action.poolUserIds!.includes(String(m.userId)));
    else ms = ms.filter((m) => m.role === 'agent');
    const base = ms.filter((m) => !exclude.includes(String(m.userId)) && !(m.onLeaveUntil && new Date(m.onLeaveUntil) > this.now()));
    const skillOk = (m: any) => (action.requireSkills ?? []).every((s) => (m.skills ?? []).map((x: string) => x.toLowerCase()).includes(s.toLowerCase()));
    const langOk = (m: any) => !lead.language || !(m.languages?.length) || m.languages.some((l: string) => l.toLowerCase() === String(lead.language).toLowerCase());
    const matching = base.filter((m) => skillOk(m) && langOk(m));
    const load = await this.openLoad(matching.map((m) => String(m.userId)));
    const underCap = matching.filter((m) => !m.maxOpenLeads || (load.get(String(m.userId)) ?? 0) < m.maxOpenLeads);
    const pres = await this.presence.get(underCap.map((m) => String(m.userId)));
    const hasPresence = (m: any) => ['online', 'on_call'].includes(pres[String(m.userId)] ?? 'offline');
    const strict = underCap.filter((m) => hasPresence(m) && withinWorkingHours(m.workingHours, this.now(), tz));
    if (strict.length) return { users: strict.map((m) => String(m.userId)), relaxed: null, notes: ['online', 'in working hours'] };
    if (underCap.length) return { users: underCap.map((m) => String(m.userId)), relaxed: 'nobody online/in working hours; assigned for first thing', notes: [] };
    return { users: [], relaxed: null, notes: [] };
  }

  private async pick(action: RuleAction, users: string[], lead: any, key: string): Promise<{ userId: string; how: string } | null> {
    if (!users.length) return null;
    const sorted = [...users].sort();
    const rr = async () => { const c: any = await this.r.counters.findOneAndUpdate({ key }, { $inc: { seq: 1 }, $setOnInsert: { key } }, { new: true, upsert: true }); return sorted[(c.seq - 1) % sorted.length]; };
    if (action.kind === 'specific_user') return { userId: sorted[0], how: 'specific user' };
    if (action.kind === 'sticky_previous_owner' && lead.lastOwnerId && sorted.includes(String(lead.lastOwnerId))) return { userId: String(lead.lastOwnerId), how: 'previous owner' };
    const strategy = action.kind === 'least_loaded' || (action.kind === 'sticky_previous_owner' && action.fallback === 'least_loaded') ? 'least_loaded' : 'round_robin';
    if (strategy === 'least_loaded') {
      const load = await this.openLoad(sorted);
      const min = Math.min(...sorted.map((u) => load.get(u) ?? 0));
      const tied = sorted.filter((u) => (load.get(u) ?? 0) === min);
      return { userId: tied.length === 1 ? tied[0] : tied[((await this.r.counters.findOneAndUpdate({ key: `${key}:tie` }, { $inc: { seq: 1 }, $setOnInsert: { key: `${key}:tie` } }, { new: true, upsert: true })) as any).seq % tied.length], how: `least loaded (${min} open)` };
    }
    return { userId: await rr(), how: `round-robin over ${sorted.length}` };
  }

  /** Decide an owner for a lead. Pure decision; `apply` persists it. */
  async decide(lead: any, o: { exclude?: string[] } = {}): Promise<Decision & { enabled: boolean }> {
    const t = await this.tenant(); const tz = t?.timezone ?? 'Asia/Kolkata';
    const rules: any[] = (await this.rules()).filter((x: any) => x.active);
    const def: RuleAction | undefined = t?.settings?.routing?.default;
    if (!rules.length && !def) return { enabled: false, userId: null, explanation: 'Routing is not configured; lead left in the manager pool' };
    const source: any = lead.sourceId ? await this.r.sources.findById(lead.sourceId) : null;
    let action: RuleAction | undefined; let label = ''; let ruleId: unknown;
    for (const rule of rules) {
      const why = this.ruleMatches(rule.conditions ?? {}, lead, source?.kind, tz);
      if (why !== null) { action = rule.action; label = `Rule "${rule.name}" (#${rule.priority}) matched: ${why}`; ruleId = rule._id; break; }
    }
    if (!action && def) { action = def; label = 'No rule matched: default pool'; }
    if (!action) return { enabled: true, userId: null, explanation: 'No rule matched and no default pool: lead left in the manager pool' };
    const c = await this.candidates(action, lead, tz, o.exclude ?? []);
    const chosen = await this.pick(action, c.users, lead, `rr:${ruleId ?? 'default'}`);
    if (!chosen) return { enabled: true, ruleId, userId: null, strategy: action.kind, explanation: `${label} -> no eligible agent (inactive, on leave, at capacity, or missing skill/language): manager pool` };
    const m: any = await this.r.memberships.findOne({ userId: chosen.userId });
    const u: any = await this.db.models.User.findById(chosen.userId, { name: 1 }).lean().exec();
    return { enabled: true, ruleId, userId: chosen.userId, strategy: action.kind, explanation: `${label} -> ${chosen.how} (${c.relaxed ?? c.notes.join(', ')}) -> ${u?.name ?? chosen.userId}${m?.teamId ? '' : ''}` };
  }

  /** Replace the SLA policies (small list; first source-scoped match wins, else the unscoped default). */
  async setSlaPolicies(ps: { name: string; claimSeconds: number; firstContactSeconds: number; maxReassignments?: number; appliesTo?: { sourceKinds?: string[] }; active?: boolean }[]) {
    for (const p of ps) {
      const errors: Record<string, string> = {};
      if (!p.name?.trim()) errors.name = 'required';
      if (!(p.claimSeconds >= 10 && p.claimSeconds <= 86400)) errors.claimSeconds = 'between 10 and 86400';
      if (!(p.firstContactSeconds >= 30 && p.firstContactSeconds <= 7 * 86400)) errors.firstContactSeconds = 'between 30 and 604800';
      if (p.firstContactSeconds < p.claimSeconds) errors.firstContactSeconds = 'must be at least the claim time';
      if (p.maxReassignments !== undefined && !(p.maxReassignments >= 0 && p.maxReassignments <= 10)) errors.maxReassignments = 'between 0 and 10';
      if (Object.keys(errors).length) throw new DomainError('invalid_sla', 'Invalid SLA policy', errors);
    }
    await this.r.slaPolicies.deleteMany({});
    if (ps.length) await this.r.slaPolicies.createMany(ps.map((p) => ({ name: p.name.trim().slice(0, 100), claimSeconds: p.claimSeconds, firstContactSeconds: p.firstContactSeconds, maxReassignments: p.maxReassignments ?? 2, appliesTo: { sourceKinds: p.appliesTo?.sourceKinds ?? [] }, active: p.active ?? true })));
    return this.r.slaPolicies.find({}, { sort: { _id: 1 } });
  }

  async slaPolicyFor(sourceKind?: string): Promise<any | null> {
    const ps: any[] = await this.r.slaPolicies.find({ active: true }, { sort: { _id: 1 } });
    return ps.find((p) => p.appliesTo?.sourceKinds?.length && sourceKind && p.appliesTo.sourceKinds.includes(sourceKind)) ?? ps.find((p) => !p.appliesTo?.sourceKinds?.length) ?? null;
  }

  /** Persist an ownership decision: owner/team, SLA timers, decision log, timeline entry, outbox event. */
  async apply(leadId: unknown, d: Decision, reason: 'new' | 'sla_claim' | 'sla_first_contact' | 'manual', carry: { reassignCount?: number; tried?: string[] } = {}) {
    const lead: any = await this.r.leads.findById(leadId as any);
    const m: any = d.userId ? await this.r.memberships.findOne({ userId: d.userId }) : null;
    const source: any = lead.sourceId ? await this.r.sources.findById(lead.sourceId) : null;
    const policy = d.userId ? await this.slaPolicyFor(source?.kind) : null;
    const now = this.now();
    const set: Record<string, unknown> = { ownerId: d.userId ? toObjectId(d.userId) : null, teamId: m?.teamId ?? null, assignedAt: now, claimedAt: null, lastOwnerId: lead.ownerId ?? lead.lastOwnerId ?? null };
    const tried = [...new Set([...(carry.tried ?? []), ...(d.userId ? [d.userId] : [])])];
    set.sla = policy
      ? { policyId: policy._id, state: 'awaiting_claim', claimDueAt: new Date(now.getTime() + policy.claimSeconds * 1000), firstContactDueAt: new Date(now.getTime() + policy.firstContactSeconds * 1000), reassignCount: carry.reassignCount ?? 0, triedUserIds: tried }
      : (d.userId ? undefined : { state: carry.reassignCount !== undefined ? 'escalated' : 'none', reassignCount: carry.reassignCount ?? 0, triedUserIds: tried });
    await this.r.leads.updateOne({ _id: lead._id }, set.sla === undefined ? { $set: { ...set }, $unset: { sla: 1 } } : { $set: set });
    await this.r.routingDecisions.create({ leadId: lead._id, ruleId: d.ruleId, chosenUserId: d.userId ? toObjectId(d.userId) : null, strategy: d.strategy, reason, explanation: d.explanation });
    await this.r.activities.create({ leadId: lead._id, type: lead.ownerId ? 'reassigned' : 'assigned', actorId: getContext()?.userId, payload: { from: lead.ownerId ?? null, to: d.userId, explanation: d.explanation, reason, claimDueAt: (set.sla as any)?.claimDueAt }, occurredAt: now });
    await this.r.outbox.add('lead.assigned', String(lead._id), { ownerId: d.userId, reason, claimDueAt: (set.sla as any)?.claimDueAt ?? null });
  }

  /** Route a freshly created lead. No-op (returns null) when the tenant has not configured routing. */
  async routeNew(leadId: unknown) {
    const lead: any = await this.r.leads.findById(leadId as any);
    const d = await this.decide(lead);
    if (!d.enabled) return null;
    await this.apply(leadId, d, 'new');
    return d;
  }

  async decisions(leadId: string) { return this.r.routingDecisions.find({ leadId: toObjectId(leadId) }, { sort: { createdAt: -1 }, limit: 50 }); }
}

export type SlaState = 'awaiting_claim' | 'claimed' | 'contacted' | 'escalated' | 'none';

/** Claim timers and first-contact escalation, stored on the lead (durable, idempotent, cancellable). */
export class SlaService {
  private readonly routing: RoutingService;
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly notifier: Notifier = new DbNotifier(db)) { this.routing = new RoutingService(db, now); }
  private get r() { return this.db.repos; }

  async claim(leadId: string, userId: string) {
    const lead: any = await this.r.leads.findById(leadId);
    if (!lead || lead.deletedAt) throw notFound('Lead');
    if (String(lead.ownerId) !== userId) throw new DomainError('forbidden', 'Only the assigned agent can claim this lead', undefined, 403);
    const res = await this.r.leads.updateOne({ _id: lead._id, 'sla.state': 'awaiting_claim', 'sla.claimDueAt': { $gte: this.now() } }, { $set: { 'sla.state': 'claimed', claimedAt: this.now(), 'sla.claimDueAt': null } });
    if (res.modifiedCount !== 1) {
      if (lead.sla?.state === 'claimed' || lead.claimedAt) return { ok: true, alreadyClaimed: true };
      throw new DomainError('claim_expired', 'The claim window has passed; this lead is being reassigned', undefined, 409);
    }
    await this.r.activities.create({ leadId: lead._id, type: 'claimed', actorId: toObjectId(userId), payload: {}, occurredAt: this.now() });
    return { ok: true, alreadyClaimed: false };
  }

  /** Called when first contact is logged: cancels the timers. */
  async markContacted(leadId: unknown) {
    await this.r.leads.updateOne({ _id: leadId, 'sla.state': { $in: ['awaiting_claim', 'claimed'] } }, { $set: { 'sla.state': 'contacted' }, $unset: { 'sla.claimDueAt': 1, 'sla.firstContactDueAt': 1 } });
  }

  /** One breached lead (runs in tenant context). Reassign to someone else, or hand to managers after max reassignments. */
  async handleBreach(leadId: string, kind: 'claim' | 'first_contact'): Promise<'reassigned' | 'escalated' | 'skip'> {
    const lead: any = await this.r.leads.findById(leadId);
    const sla = lead?.sla;
    if (!lead || lead.deletedAt || !sla || !['awaiting_claim', 'claimed'].includes(sla.state) || lead.firstContactedAt) return 'skip';
    const due = kind === 'claim' ? sla.claimDueAt : sla.firstContactDueAt;
    if (!due || new Date(due).getTime() > this.now().getTime()) return 'skip';
    if (kind === 'claim' && sla.state !== 'awaiting_claim') return 'skip';
    // atomic claim of this breach so two sweepers cannot both reassign
    const dueField = kind === 'claim' ? 'sla.claimDueAt' : 'sla.firstContactDueAt';
    const lock = await this.r.leads.updateOne({ _id: lead._id, 'sla.state': sla.state, [dueField]: due }, { $set: { 'sla.state': 'escalated' } });
    if (lock.modifiedCount !== 1) return 'skip';
    const policy: any = sla.policyId ? await this.r.slaPolicies.findById(sla.policyId) : null;
    const count = (sla.reassignCount ?? 0) + 1;
    const previous = lead.ownerId ? String(lead.ownerId) : null;
    const reason = kind === 'claim' ? 'sla_claim' : 'sla_first_contact';
    const payload = { leadId: String(lead._id), leadName: lead.displayName, kind, previousOwnerId: previous };
    if (previous) await this.notifier.notify({ kind: 'sla.breached', audience: 'user', userId: previous, payload, dedupeKey: `sla:${lead._id}:${count}:user` });
    if (count > (policy?.maxReassignments ?? 2)) {
      await this.routing.apply(lead._id, { userId: null, explanation: `SLA ${kind === 'claim' ? 'claim' : 'first-contact'} timer expired ${count} times: handed to the manager pool` }, reason, { reassignCount: count, tried: sla.triedUserIds });
      await this.r.leads.updateOne({ _id: lead._id }, { $set: { 'sla.state': 'escalated' } });
      await this.notifier.notify({ kind: 'lead.unclaimed', audience: 'managers', payload, dedupeKey: `sla:${lead._id}:${count}:mgr` });
      return 'escalated';
    }
    const d = await this.routing.decide({ ...lead, lastOwnerId: lead.ownerId }, { exclude: sla.triedUserIds ?? (previous ? [previous] : []) });
    if (!d.userId) {
      await this.routing.apply(lead._id, { ...d, userId: null, explanation: `${d.explanation} (after SLA ${kind} timeout)` }, reason, { reassignCount: count, tried: sla.triedUserIds });
      await this.notifier.notify({ kind: 'lead.unclaimed', audience: 'managers', payload, dedupeKey: `sla:${lead._id}:${count}:mgr` });
      return 'escalated';
    }
    await this.routing.apply(lead._id, { ...d, explanation: `SLA ${kind === 'claim' ? 'claim' : 'first-contact'} timeout: ${d.explanation}` }, reason, { reassignCount: count, tried: sla.triedUserIds });
    await this.notifier.notify({ kind: 'lead.assigned', audience: 'user', userId: d.userId, payload: { ...payload, reassigned: true }, dedupeKey: `sla:${lead._id}:${count}:new` });
    return 'reassigned';
  }

  async sweepAll(sys: SystemOps): Promise<{ reassigned: number; escalated: number }> {
    const out = { reassigned: 0, escalated: 0 };
    for (const c of (await sys.slaDue(this.now())) as any[]) {
      const r = await runWithTenant(String(c.tenantId), () => new SlaService(this.db, this.now, this.notifier).handleBreach(String(c._id), c.kind));
      if (r === 'reassigned') out.reassigned++; else if (r === 'escalated') out.escalated++;
    }
    return out;
  }
}
