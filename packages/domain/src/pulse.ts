import { requireTenantId, toObjectId, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DbNotifier, type Notifier } from './integrity';
import { PresenceService } from './routing';

export type Range = 'today' | '7d' | '30d';
export interface Win { from: Date; to: Date; prevFrom: Date; prevTo: Date }
export interface Metrics { responseMedianS: number | null; withinSlaPct: number | null; connectRate: number | null; avgTalkS: number | null; conversionPct: number | null; followUpPct: number | null }
export interface PulseSettings { gamification: boolean; dailyGoal: number; digestHour: number; untouchedHours: number; abandonedDays: number }
const DEFAULTS: PulseSettings = { gamification: true, dailyGoal: 10, digestHour: 8, untouchedHours: 24, abandonedDays: 7 };
const DAY = 86_400_000;
const SAMPLE = 200; // ids returned per leakage bucket (enough for one-click bulk reassign)
const MAX_ROWS = 50_000;

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Local calendar parts of `d` in `tz`. */
function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => Number(f.find((p) => p.type === t)!.value);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}
export function startOfLocalDay(d: Date, tz: string): Date {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d) - (asUtc - Math.floor(d.getTime() / 1000) * 1000));
}
export const localDay = (d: Date, tz: string) => { const p = parts(d, tz); return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
export const localHour = (d: Date, tz: string) => parts(d, tz).h;

export function windowFor(range: Range, now: Date, tz: string): Win {
  if (range === 'today') { const from = startOfLocalDay(now, tz); return { from, to: now, prevFrom: new Date(from.getTime() - DAY), prevTo: new Date(now.getTime() - DAY) }; }
  const n = range === '7d' ? 7 : 30; const from = new Date(now.getTime() - n * DAY);
  return { from, to: now, prevFrom: new Date(from.getTime() - n * DAY), prevTo: from };
}

export type Insight = { id: string; severity: 'high' | 'medium' | 'info'; text: string; metric?: Record<string, unknown> };

/** Manager analytics. Everything is derived from the operational collections (tenant-scoped), never from client input. */
export class PulseService {
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly notifier: Notifier = new DbNotifier(db)) {}
  private get r() { return this.db.repos; }

  private async tenant(): Promise<any> { return this.db.models.Tenant.findById(requireTenantId()).lean().exec(); }
  async settings(): Promise<PulseSettings & { tz: string; slaS: number }> {
    const t = await this.tenant();
    return { ...DEFAULTS, ...(t?.settings?.pulse ?? {}), tz: t?.timezone ?? 'Asia/Kolkata', slaS: t?.settings?.sla?.firstContactSeconds ?? 900 };
  }
  async updateSettings(p: Partial<PulseSettings>) {
    const clean: Record<string, unknown> = {};
    if (typeof p.gamification === 'boolean') clean['settings.pulse.gamification'] = p.gamification;
    if (Number.isInteger(p.dailyGoal) && p.dailyGoal! >= 1 && p.dailyGoal! <= 500) clean['settings.pulse.dailyGoal'] = p.dailyGoal;
    if (Number.isInteger(p.digestHour) && p.digestHour! >= 0 && p.digestHour! <= 23) clean['settings.pulse.digestHour'] = p.digestHour;
    if (Number.isInteger(p.untouchedHours) && p.untouchedHours! >= 1 && p.untouchedHours! <= 720) clean['settings.pulse.untouchedHours'] = p.untouchedHours;
    if (Number.isInteger(p.abandonedDays) && p.abandonedDays! >= 1 && p.abandonedDays! <= 365) clean['settings.pulse.abandonedDays'] = p.abandonedDays;
    if (Object.keys(clean).length) await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: clean });
    return this.settings();
  }

  private async statusInfo() {
    const all: any[] = await this.r.statuses.find({}, { sort: { position: 1 } });
    const open = all.filter((s) => s.kind === 'open');
    const kind = new Map(all.map((s) => [String(s._id), s.kind as string]));
    const rank = new Map(open.map((s, i) => [String(s._id), i]));
    return { openIds: open.map((s) => s._id), kind, rank, wonIds: all.filter((s) => s.kind === 'won').map((s) => s._id) };
  }
  private openFilter(openIds: unknown[]) { return { $or: [{ statusId: { $in: openIds } }, { statusId: null }] }; }

  /** First-contact deadline of a lead: its stored SLA timer, else created/assigned + the tenant default. */
  private dueOf(l: any, slaS: number): number { return l.sla?.firstContactDueAt ? new Date(l.sla.firstContactDueAt).getTime() : new Date(l.assignedAt ?? l.createdAt).getTime() + slaS * 1000; }
  private respS(l: any): number | null { return l.firstContactedAt ? Math.max(0, Math.round((new Date(l.firstContactedAt).getTime() - new Date(l.assignedAt ?? l.createdAt).getTime()) / 1000)) : null; }

  // ---------------- 1. five core KPIs ----------------
  private async metricsFor(from: Date, to: Date, s: { slaS: number }, ownerId?: unknown) {
    const st = await this.statusInfo();
    const own = ownerId ? { ownerId: toObjectId(String(ownerId)) } : {};
    const leads: any[] = await this.r.leads.find({ createdAt: { $gte: from, $lt: to }, deletedAt: null, ...own }, { projection: { createdAt: 1, assignedAt: 1, firstContactedAt: 1, sla: 1, statusId: 1 }, limit: MAX_ROWS });
    const resp = leads.map((l) => this.respS(l)).filter((x): x is number => x !== null);
    const judged = leads.filter((l) => l.firstContactedAt || this.dueOf(l, s.slaS) <= to.getTime());
    const inSla = judged.filter((l) => l.firstContactedAt && new Date(l.firstContactedAt).getTime() <= this.dueOf(l, s.slaS)).length;
    const won = leads.filter((l) => st.kind.get(String(l.statusId)) === 'won').length;

    const outcomes: any[] = await this.r.outcomes.find({});
    const okind = new Map(outcomes.map((o) => [String(o._id), o.kind as string]));
    const calls: any[] = await this.r.callSessions.find({ startedAt: { $gte: from, $lt: to }, ...(ownerId ? { agentId: toObjectId(String(ownerId)) } : {}) }, { projection: { outcomeId: 1, outcomeLoggedAt: 1, durationS: 1, durationSource: 1, outcomeSkips: 1, state: 1 }, limit: MAX_ROWS });
    const logged = calls.filter((c) => c.outcomeLoggedAt && c.outcomeId);
    const connected = logged.filter((c) => okind.get(String(c.outcomeId)) === 'connected');
    const talk = connected.map((c) => c.durationS).filter((x): x is number => typeof x === 'number' && x > 0);

    const tasks: any[] = await this.r.tasks.find({ dueAt: { $gte: from, $lt: to, $lte: to }, status: { $in: ['open', 'done', 'missed'] }, ...(ownerId ? { assigneeId: toObjectId(String(ownerId)) } : {}) }, { projection: { dueAt: 1, status: 1, completedAt: 1, graceMinutes: 1 }, limit: MAX_ROWS });
    const onTime = tasks.filter((t) => t.status === 'done' && t.completedAt && new Date(t.completedAt).getTime() <= new Date(t.dueAt).getTime() + (t.graceMinutes ?? 15) * 60_000).length;

    const metrics: Metrics = { responseMedianS: median(resp), withinSlaPct: pct(inSla, judged.length), connectRate: pct(connected.length, logged.length), avgTalkS: mean(talk), conversionPct: pct(won, leads.length), followUpPct: pct(onTime, tasks.length) };
    const verified = calls.filter((c) => c.state === 'ended' || c.outcomeLoggedAt);
    return {
      metrics,
      counts: { leads: leads.length, contacted: resp.length, calls: logged.length, connected: connected.length, tasksDue: tasks.length, tasksOnTime: onTime, won, outcomeSkips: calls.reduce((a, c) => a + (c.outcomeSkips ?? 0), 0) },
      verifiedCallShare: pct(verified.filter((c) => c.durationSource === 'system').length, verified.length), // the rest is self-reported
    };
  }

  async kpis(range: Range = '7d') {
    const s = await this.settings(); const w = windowFor(range, this.now(), s.tz);
    const [cur, prev] = await Promise.all([this.metricsFor(w.from, w.to, s), this.metricsFor(w.prevFrom, w.prevTo, s)]);
    const trend: Record<string, number | null> = {};
    for (const k of Object.keys(cur.metrics) as (keyof Metrics)[]) { const a = cur.metrics[k], b = prev.metrics[k]; trend[k] = a === null || b === null || b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10; }
    return { range, from: w.from, to: w.to, ...cur, previous: prev.metrics, previousCounts: prev.counts, trendPct: trend };
  }

  // ---------------- 2. live team board ----------------
  private async names(ids: unknown[]): Promise<Map<string, { name: string; email: string }>> {
    const us: any[] = ids.length ? await this.db.models.User.find({ _id: { $in: ids } }, { name: 1, email: 1 }).lean().exec() : [];
    return new Map(us.map((u) => [String(u._id), { name: u.name ?? u.email, email: u.email }]));
  }
  async team() {
    const now = this.now(); const st = await this.statusInfo();
    const mem: any[] = await this.r.memberships.find({ status: 'active' });
    const ids = mem.map((m) => m.userId);
    const [names, pres] = await Promise.all([this.names(ids), new PresenceService(this.db, this.now).get(ids.map(String))]);
    const overdue: any[] = await this.r.tasks.aggregate([{ $match: { status: { $in: ['open', 'missed'] }, dueAt: { $lt: now } } }, { $group: { _id: '$assigneeId', n: { $sum: 1 } } }]);
    const awaiting: any[] = await this.r.leads.aggregate([{ $match: { deletedAt: null, firstContactedAt: null, ...this.openFilter(st.openIds) } }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]);
    const open: any[] = await this.r.leads.aggregate([{ $match: { deletedAt: null, ...this.openFilter(st.openIds) } }, { $group: { _id: '$ownerId', n: { $sum: 1 } } }]);
    const by = (rows: any[]) => new Map(rows.map((x) => [String(x._id), x.n as number]));
    const o = by(overdue), a = by(awaiting), op = by(open);
    const members = mem.filter((m) => m.role === 'agent' || m.role === 'manager').map((m) => ({
      userId: String(m.userId), name: names.get(String(m.userId))?.name ?? 'Unknown', role: m.role,
      presence: (pres[String(m.userId)] ?? 'offline') as string, overdue: o.get(String(m.userId)) ?? 0, awaitingFirstContact: a.get(String(m.userId)) ?? 0, openLeads: op.get(String(m.userId)) ?? 0,
    })).sort((x, y) => y.overdue - x.overdue || x.name.localeCompare(y.name));
    const summary = { online: members.filter((m) => m.presence === 'online').length, onCall: members.filter((m) => m.presence === 'on_call').length, idle: members.filter((m) => m.presence === 'away').length, offline: members.filter((m) => m.presence === 'offline').length };
    return { members, summary, unassignedAwaitingFirstContact: a.get('null') ?? a.get('undefined') ?? 0, totalOverdue: [...o.values()].reduce((x, y) => x + y, 0) };
  }

  // ---------------- 3. leakage ----------------
  async leakage(o: { untouchedHours?: number; abandonedDays?: number; range?: Range } = {}) {
    const s = await this.settings(); const now = this.now(); const st = await this.statusInfo();
    const untouchedHours = o.untouchedHours ?? s.untouchedHours, abandonedDays = o.abandonedDays ?? s.abandonedDays;
    const w = windowFor(o.range ?? '7d', now, s.tz);
    const bucket = async (filter: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<{ count: number; leads: { leadId: string; name: string; ownerId: string | null; createdAt: Date }[]; thresholdHours?: number; thresholdDays?: number }> => {
      const count = await this.r.leads.count(filter);
      const rows: any[] = await this.r.leads.find(filter, { sort: { createdAt: 1 }, limit: SAMPLE, projection: { displayName: 1, ownerId: 1, createdAt: 1, lastContactedAt: 1 } });
      return { count, ...(extra as object), leads: rows.map((l) => ({ leadId: String(l._id), name: l.displayName, ownerId: l.ownerId ? String(l.ownerId) : null, createdAt: l.createdAt })) };
    };
    const untouched = await bucket({ deletedAt: null, firstContactedAt: null, createdAt: { $lt: new Date(now.getTime() - untouchedHours * 3600_000) }, ...this.openFilter(st.openIds) }, { thresholdHours: untouchedHours });
    const abandoned = await bucket({ deletedAt: null, firstContactedAt: { $ne: null }, lastContactedAt: { $lt: new Date(now.getTime() - abandonedDays * DAY) }, nextActionAt: null, ...this.openFilter(st.openIds) }, { thresholdDays: abandonedDays });
    // late first contact: contacted after the deadline, inside the window
    const contacted: any[] = await this.r.leads.find({ deletedAt: null, createdAt: { $gte: w.from, $lt: w.to }, firstContactedAt: { $ne: null } }, { projection: { createdAt: 1, assignedAt: 1, firstContactedAt: 1, sla: 1, displayName: 1, ownerId: 1 }, limit: MAX_ROWS });
    const late = contacted.filter((l) => new Date(l.firstContactedAt).getTime() > this.dueOf(l, s.slaS));
    const missedTasks: any[] = await this.r.tasks.find({ status: 'missed' }, { sort: { dueAt: 1 }, limit: SAMPLE });
    const missedCount = await this.r.tasks.count({ status: 'missed' });
    const mLeads: any[] = missedTasks.length ? await this.r.leads.find({ _id: { $in: missedTasks.map((t) => t.leadId) }, deletedAt: null }, { projection: { displayName: 1, ownerId: 1, createdAt: 1 } }) : [];
    const mById = new Map(mLeads.map((l) => [String(l._id), l]));
    const seen = new Set<string>();
    return {
      untouched, abandoned,
      lateFirstContact: { count: late.length, range: o.range ?? '7d', leads: late.slice(0, SAMPLE).map((l) => ({ leadId: String(l._id), name: l.displayName, ownerId: l.ownerId ? String(l.ownerId) : null, lateByS: Math.round((new Date(l.firstContactedAt).getTime() - this.dueOf(l, s.slaS)) / 1000) })) },
      missedFollowUps: { count: missedCount, leads: missedTasks.filter((t) => { const k = String(t.leadId); if (seen.has(k) || !mById.has(k)) return false; seen.add(k); return true; }).map((t) => { const l = mById.get(String(t.leadId)); return { leadId: String(t.leadId), name: l.displayName, ownerId: String(t.assigneeId), dueAt: t.dueAt, note: t.contextNote }; }) },
    };
  }

  // ---------------- 4. source quality ----------------
  async sources(o: { groupBy?: 'source' | 'campaign' | 'ad'; range?: Range } = {}) {
    const s = await this.settings(); const w = windowFor(o.range ?? '30d', this.now(), s.tz); const st = await this.statusInfo();
    const groupBy = o.groupBy ?? 'source';
    const srcs: any[] = await this.r.sources.find({});
    const sname = new Map(srcs.map((x) => [String(x._id), x.name as string]));
    const leads: any[] = await this.r.leads.find({ createdAt: { $gte: w.from, $lt: w.to }, deletedAt: null }, { projection: { sourceId: 1, campaign: 1, ad: 1, createdAt: 1, assignedAt: 1, firstContactedAt: 1, statusId: 1 }, limit: MAX_ROWS });
    const groups = new Map<string, any[]>();
    for (const l of leads) {
      const key = groupBy === 'source' ? (sname.get(String(l.sourceId)) ?? 'Unknown') : groupBy === 'campaign' ? (l.campaign || '(no campaign)') : (l.ad || '(no ad)');
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(l);
    }
    const rows = [...groups.entries()].map(([name, ls]) => {
      const contacted = ls.filter((l) => l.firstContactedAt).length;
      const won = ls.filter((l) => st.kind.get(String(l.statusId)) === 'won').length;
      const qualified = ls.filter((l) => { const k = st.kind.get(String(l.statusId)); return k === 'won' || (k === 'open' && (st.rank.get(String(l.statusId)) ?? 0) >= 2); }).length; // reached the 3rd open stage or won
      return { name, leads: ls.length, contactedPct: pct(contacted, ls.length), qualifiedPct: pct(qualified, ls.length), wonPct: pct(won, ls.length), won, responseMedianS: median(ls.map((l) => this.respS(l)).filter((x): x is number => x !== null)) };
    }).sort((a, b) => b.leads - a.leads);
    return { groupBy, range: o.range ?? '30d', rows, costPerLead: null as null }; // cost needs ad spend / Marketing API: later
  }

  // ---------------- 5. agent scorecards ----------------
  async agents(range: Range = '7d') {
    const s = await this.settings(); const w = windowFor(range, this.now(), s.tz);
    const mem: any[] = (await this.r.memberships.find({ status: 'active' })).filter((m: any) => m.role === 'agent' || m.role === 'manager');
    const names = await this.names(mem.map((m) => m.userId));
    const rows = [];
    for (const m of mem) {
      const x = await this.metricsFor(w.from, w.to, s, m.userId);
      rows.push({ userId: String(m.userId), name: names.get(String(m.userId))?.name ?? 'Unknown', role: m.role, ...x.metrics, leads: x.counts.leads, calls: x.counts.calls, outcomeSkips: x.counts.outcomeSkips, tasksDue: x.counts.tasksDue, verifiedCallShare: x.verifiedCallShare });
    }
    return { range, rows: rows.sort((a, b) => (b.followUpPct ?? -1) - (a.followUpPct ?? -1) || a.name.localeCompare(b.name)) };
  }

  // ---------------- 6. insight cards (rules first; wording by AI is optional later) ----------------
  async insights(): Promise<Insight[]> {
    const out: Insight[] = [];
    const s = await this.settings(); const now = this.now();
    const [k, lk] = await Promise.all([this.kpis('7d'), this.leakage()]);
    if (lk.untouched.count > 0) out.push({ id: 'untouched', severity: lk.untouched.count >= 10 ? 'high' : 'medium', text: `${lk.untouched.count} lead${lk.untouched.count === 1 ? '' : 's'} untouched for over ${lk.untouched.thresholdHours} h`, metric: { count: lk.untouched.count } });
    if (lk.missedFollowUps.count > 0) out.push({ id: 'missed', severity: lk.missedFollowUps.count >= 10 ? 'high' : 'medium', text: `${lk.missedFollowUps.count} missed follow-up${lk.missedFollowUps.count === 1 ? '' : 's'} waiting to be handled`, metric: { count: lk.missedFollowUps.count } });
    const rt = k.metrics.responseMedianS, rp = k.previous.responseMedianS;
    if (rt !== null && rp !== null && rp > 0 && rt >= rp * 1.5 && k.counts.contacted >= 5) out.push({ id: 'response_slower', severity: 'medium', text: `Median response time rose ${Math.round(((rt - rp) / rp) * 100)}% vs the previous 7 days (${Math.round(rt / 60)} min)`, metric: { now: rt, before: rp } });
    if (k.metrics.withinSlaPct !== null && k.metrics.withinSlaPct < 70 && k.counts.leads >= 5) out.push({ id: 'sla_low', severity: 'high', text: `Only ${k.metrics.withinSlaPct}% of new leads were contacted within the SLA this week`, metric: { pct: k.metrics.withinSlaPct } });
    if (k.verifiedCallShare !== null && k.verifiedCallShare < 50 && k.counts.calls >= 10) out.push({ id: 'unverified_calls', severity: 'info', text: `${100 - k.verifiedCallShare}% of calls are self-reported. Connect cloud telephony for verified talk time and connect rate`, metric: { verifiedShare: k.verifiedCallShare } });
    if (k.counts.outcomeSkips >= 5) out.push({ id: 'skips', severity: 'info', text: `Agents skipped ${k.counts.outcomeSkips} outcome sheets this week`, metric: { skips: k.counts.outcomeSkips } });
    // a source whose won-rate fell >30% vs the previous week (min sample on both sides)
    const w = windowFor('7d', now, s.tz);
    const [cur, prev] = [await this.sourceRates(w.from, w.to), await this.sourceRates(w.prevFrom, w.prevTo)];
    for (const [name, c] of cur) { const p = prev.get(name); if (p && p.n >= 10 && c.n >= 10 && p.rate > 0 && c.rate <= p.rate * 0.7) out.push({ id: `source:${name}`, severity: 'medium', text: `Conversion from ${name} fell ${Math.round((1 - c.rate / p.rate) * 100)}% vs last week`, metric: { source: name, now: c.rate, before: p.rate } }); }
    const rank = { high: 0, medium: 1, info: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }
  private async sourceRates(from: Date, to: Date) {
    const st = await this.statusInfo(); const srcs: any[] = await this.r.sources.find({});
    const sname = new Map(srcs.map((x) => [String(x._id), x.name as string]));
    const ls: any[] = await this.r.leads.find({ createdAt: { $gte: from, $lt: to }, deletedAt: null }, { projection: { sourceId: 1, statusId: 1 }, limit: MAX_ROWS });
    const m = new Map<string, { n: number; won: number; rate: number }>();
    for (const l of ls) { const k = sname.get(String(l.sourceId)) ?? 'Unknown'; const e = m.get(k) ?? { n: 0, won: 0, rate: 0 }; e.n++; if (st.kind.get(String(l.statusId)) === 'won') e.won++; e.rate = e.won / e.n; m.set(k, e); }
    return m;
  }

  // ---------------- agent view: goal ring, streak, public leaderboard ----------------
  async me(userId: string) {
    const s = await this.settings(); const now = this.now();
    if (!s.gamification) return { gamification: false as const };
    const start = startOfLocalDay(now, s.tz);
    const since = new Date(start.getTime() - 30 * DAY);
    const acts: any[] = await this.r.activities.find({ actorId: userId, type: { $in: ['call_ended', 'message_out'] }, occurredAt: { $gte: since } }, { projection: { occurredAt: 1 }, limit: MAX_ROWS });
    const byDay = new Map<string, number>();
    for (const a of acts) { const d = localDay(new Date(a.occurredAt), s.tz); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
    const today = localDay(now, s.tz); const done = byDay.get(today) ?? 0;
    let streak = 0; // consecutive goal days; today counts once reached, otherwise the run ending yesterday is kept
    for (let i = done >= s.dailyGoal ? 0 : 1; i < 31; i++) { const d = localDay(new Date(start.getTime() - i * DAY + 12 * 3600_000), s.tz); if ((byDay.get(d) ?? 0) >= s.dailyGoal) streak++; else break; }
    const board = (await this.agents('7d')).rows.filter((r) => r.tasksDue > 0).map((r) => ({ userId: r.userId, name: r.name, followUpPct: r.followUpPct, tasksDue: r.tasksDue })).sort((a, b) => (b.followUpPct ?? 0) - (a.followUpPct ?? 0));
    return { gamification: true as const, goal: s.dailyGoal, done, streakDays: streak, leaderboard: board };
  }

  // ---------------- daily rollup + digest ----------------
  /** Idempotent: one document per tenant-local day. */
  async rollupDay(day: string, from: Date, to: Date) {
    const s = await this.settings(); const x = await this.metricsFor(from, to, s);
    const lk = await this.leakage();
    const leakage = { untouched: lk.untouched.count, abandoned: lk.abandoned.count, missedFollowUps: lk.missedFollowUps.count, lateFirstContact: lk.lateFirstContact.count };
    await this.r.pulseDaily.updateOne({ day }, { $set: { kpis: x.metrics, counts: x.counts, leakage } }, { upsert: true });
    return { day, kpis: x.metrics, counts: x.counts, leakage };
  }
  async trend(days = 30) {
    const rows: any[] = await this.r.pulseDaily.find({}, { sort: { day: -1 }, limit: Math.min(Math.max(days, 1), 90) });
    return rows.reverse().map((d) => ({ day: d.day, ...d.kpis, leads: d.counts?.leads ?? 0, calls: d.counts?.calls ?? 0 }));
  }

  /** Yesterday's numbers + leakage + top/bottom agents, delivered in-app to managers/owners (dedupe: once per local day). */
  async sendDigest(o: { insight?: (i: { day: string; kpis: unknown; counts: unknown; leakage: unknown; trend: unknown }) => Promise<{ headline: string; bullets: string[]; watch?: string } | null> } = {}): Promise<{ sent: boolean; day: string }> {
    const s = await this.settings(); const now = this.now();
    const today = startOfLocalDay(now, s.tz); const yStart = new Date(today.getTime() - DAY);
    const day = localDay(new Date(yStart.getTime() + 12 * 3600_000), s.tz); // yesterday's local date
    const y = await this.rollupDay(day, yStart, today);
    const w = { from: yStart, to: today };
    const mem: any[] = (await this.r.memberships.find({ status: 'active' })).filter((m: any) => m.role === 'agent');
    const names = await this.names(mem.map((m) => m.userId));
    const per = [];
    for (const m of mem) { const x = await this.metricsFor(w.from, w.to, s, m.userId); if (x.counts.calls || x.counts.tasksDue) per.push({ name: names.get(String(m.userId))?.name ?? 'Unknown', calls: x.counts.calls, followUpPct: x.metrics.followUpPct }); }
    per.sort((a, b) => b.calls - a.calls);
    const payload: Record<string, unknown> = { day, kpis: y.kpis, counts: y.counts, leakage: y.leakage, topAgents: per.slice(0, 3), bottomAgents: per.length > 3 ? per.slice(-3).reverse() : [], text: this.digestText(day, y, per) };
    const before = await this.r.notifications.count({ kind: 'pulse.digest', dedupeKey: `pulse-digest:${day}` });
    if (before === 0 && o.insight) {
      // optional, labelled, and bounded: the digest goes out with or without it
      const ins = await Promise.race([o.insight({ day, kpis: y.kpis, counts: y.counts, leakage: y.leakage, trend: await this.trend(7) }).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]);
      if (ins) { payload.insight = ins; payload.text = `${payload.text}\n\nAI-written summary: ${ins.headline}\n${ins.bullets.map((b) => `• ${b}`).join('\n')}${ins.watch ? `\nWatch: ${ins.watch}` : ''}`; }
    }
    await this.notifier.notify({ kind: 'pulse.digest', audience: 'managers', payload, dedupeKey: `pulse-digest:${day}` });
    return { sent: before === 0, day };
  }
  private digestText(day: string, y: { kpis: Metrics; counts: any; leakage: any }, per: { name: string; calls: number }[]) {
    const m = y.kpis; const f = (v: number | null, u = '') => (v === null ? '–' : `${v}${u}`);
    return [`Pulse digest for ${day}`, `New leads ${y.counts.leads} · median response ${m.responseMedianS === null ? '–' : Math.round(m.responseMedianS / 60) + ' min'} · within SLA ${f(m.withinSlaPct, '%')}`,
      `Connect rate ${f(m.connectRate, '%')} · avg talk ${m.avgTalkS === null ? '–' : Math.round(m.avgTalkS / 60) + ' min'} · conversion ${f(m.conversionPct, '%')} · follow-ups on time ${f(m.followUpPct, '%')}`,
      `Leaking: ${y.leakage.untouched} untouched, ${y.leakage.missedFollowUps} missed follow-ups, ${y.leakage.abandoned} abandoned`,
      per.length ? `Most calls: ${per[0].name} (${per[0].calls})` : 'No calls logged'].join('\n');
  }

  /** Worker entry (hourly): for each tenant, once its local digest hour has passed, roll up yesterday and send the digest. */
  static async sweepAll(db: TenantDb, sys: SystemOps, now: () => Date = () => new Date(), insight?: NonNullable<Parameters<PulseService['sendDigest']>[0]>['insight']) {
    const { runWithTenant } = await import('@leaddesk/db');
    let sent = 0;
    for (const t of (await sys.pulseTenants()) as any[]) {
      const tz = t.timezone ?? 'Asia/Kolkata'; const hour = t.settings?.pulse?.digestHour ?? DEFAULTS.digestHour;
      if (localHour(now(), tz) < hour) continue;
      try { if ((await runWithTenant(String(t._id), () => new PulseService(db, now).sendDigest({ insight }))).sent) sent++; } catch { /* one tenant must not stop the others */ }
    }
    return { sent };
  }

  csv(rows: Record<string, unknown>[]) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => { let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // neutralise spreadsheet formulas
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
  }
}
