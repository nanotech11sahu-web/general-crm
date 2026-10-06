import { getContext, requireTenantId, runWithTenant, toObjectId, withTransaction, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { DbNotifier, type Notifier } from './integrity';
import { LeadService } from './lead-service';
import { PresenceService, SlaService } from './routing';

export type TaskType = 'call' | 'whatsapp' | 'sms' | 'visit' | 'other';
export interface NextAction { dueAt: Date | string; contextNote: string; type?: TaskType }

export interface DoSettings {
  firstContactSeconds: number; graceMinutes: number; escalateAfterHours: number;
  maxOutcomeSkipsPerDay: number; staleDays: number; autoReassignOnEscalation: boolean; sourceWeights: Record<string, number>;
}
export const DEFAULT_SETTINGS: DoSettings = { firstContactSeconds: 900, graceMinutes: 15, escalateAfterHours: 4, maxOutcomeSkipsPerDay: 3, staleDays: 7, autoReassignOnEscalation: false, sourceWeights: {} };

const VAGUE = /^(follow ?up|call ?back|callback|call|na|n\/a|none|test|ok|todo|later|tbd)\.?$/i;

/** A next action must be concrete: a real future time and a note a colleague could act on. */
export function validateNextAction(n: NextAction | undefined, now: Date): { dueAt: Date; contextNote: string; type: TaskType } {
  const errors: Record<string, string> = {};
  const dueAt = n?.dueAt ? new Date(n.dueAt) : undefined;
  if (!dueAt || Number.isNaN(dueAt.getTime())) errors.dueAt = 'pick a date and time';
  else if (dueAt.getTime() < now.getTime() + 30_000) errors.dueAt = 'must be in the future';
  else if (dueAt.getTime() > now.getTime() + 366 * 86_400_000) errors.dueAt = 'must be within a year';
  const note = String(n?.contextNote ?? '').trim();
  if (note.length < 10 || note.split(/\s+/).length < 2 || VAGUE.test(note)) errors.contextNote = 'say what to do and why (at least 10 characters, e.g. "Asked to call Friday after 6 PM about 3BHK")';
  if (Object.keys(errors).length) throw new DomainError('invalid_next_action', 'A follow-up needs a specific time and a useful note', errors);
  return { dueAt: dueAt!, contextNote: note.slice(0, 500), type: n?.type ?? 'call' };
}

const ago = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

export type QueueKind = 'outcome_pending' | 'new_lead' | 'overdue_task' | 'due_task' | 'inbound' | 'stale';
const TIER: Record<QueueKind, number> = { outcome_pending: 0, new_lead: 1, overdue_task: 2, due_task: 3, inbound: 4, stale: 5 };
export interface QueueItem {
  kind: QueueKind; leadId: string; leadName: string; reason: string; dueAt?: Date; priority: number;
  suggestedAction: { type: TaskType | 'log_outcome' }; taskId?: string; callSessionId?: string;
}

export class DoService {
  private readonly leads: LeadService;
  private readonly presence: PresenceService;
  private readonly sla: SlaService;
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly notifier: Notifier = new DbNotifier(db)) { this.leads = new LeadService(db); this.presence = new PresenceService(db, now); this.sla = new SlaService(db, now, notifier); }
  private get r() { return this.db.repos; }
  private actor(): string { const id = getContext()?.userId; if (!id) throw new DomainError('unauthenticated', 'No acting user', undefined, 401); return id; }

  async settings(): Promise<DoSettings> {
    const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec();
    const s = t?.settings ?? {};
    return { ...DEFAULT_SETTINGS, ...(s.do ?? {}), firstContactSeconds: s.sla?.firstContactSeconds ?? DEFAULT_SETTINGS.firstContactSeconds };
  }

  getLead(id: string) { return this.leads.get(id); }

  private async activity(leadId: unknown, type: string, payload: Record<string, unknown>) {
    await this.r.activities.create({ leadId, type, actorId: getContext()?.userId, payload, occurredAt: this.now() });
  }

  // ---------------- tasks ----------------
  async createTask(i: { leadId: string; assigneeId?: string; next: NextAction; outcomeId?: unknown }) {
    const lead: any = await this.leads.get(i.leadId);
    const assignee = i.assigneeId ?? this.actor();
    if (!(await this.r.memberships.findOne({ userId: assignee, status: 'active' }))) throw new DomainError('invalid_assignee', 'Assignee is not an active member');
    const n = validateNextAction(i.next, this.now());
    const s = await this.settings();
    const task: any = await this.r.tasks.create({ leadId: lead._id, assigneeId: toObjectId(assignee), type: n.type, dueAt: n.dueAt, contextNote: n.contextNote, graceMinutes: s.graceMinutes, createdFromOutcomeId: i.outcomeId, status: 'open' });
    await this.r.leads.updateOne({ _id: lead._id }, { $set: { nextActionAt: await this.earliestOpenDue(lead._id) } });
    await this.activity(lead._id, 'task_created', { taskId: String(task._id), type: n.type, dueAt: n.dueAt, note: n.contextNote });
    await this.r.outbox.add('task.created', String(task._id), { leadId: String(lead._id), assigneeId: assignee });
    return task;
  }

  private async earliestOpenDue(leadId: unknown): Promise<Date | null> {
    const t: any = (await this.r.tasks.find({ leadId, status: 'open' }, { sort: { dueAt: 1 }, limit: 1 }))[0];
    return t?.dueAt ?? null;
  }

  async getTask(id: string) {
    const t: any = await this.r.tasks.findById(id);
    if (!t) throw notFound('Task');
    return t;
  }

  async completeTask(id: string, o: { assigneeCheck?: string } = {}) {
    const t = await this.getTask(id);
    if (o.assigneeCheck && String(t.assigneeId) !== o.assigneeCheck) throw new DomainError('forbidden', 'Not your task', undefined, 403);
    if (t.status === 'done') return t;
    if (t.status === 'cancelled') throw new DomainError('invalid_state', 'Task is cancelled');
    await this.r.tasks.updateOne({ _id: t._id }, { $set: { status: 'done', completedAt: this.now() } });
    await this.r.leads.updateOne({ _id: t.leadId }, { $set: { nextActionAt: await this.earliestOpenDue(t.leadId) } });
    await this.activity(t.leadId, 'task_done', { taskId: String(t._id), late: t.status === 'missed' });
    return this.getTask(id);
  }

  async rescheduleTask(id: string, next: { dueAt: Date | string; contextNote?: string }) {
    const t = await this.getTask(id);
    if (t.status === 'done' || t.status === 'cancelled') throw new DomainError('invalid_state', `Task is ${t.status}`);
    const n = validateNextAction({ dueAt: next.dueAt, contextNote: next.contextNote ?? t.contextNote, type: t.type }, this.now());
    await this.r.tasks.updateOne({ _id: t._id }, { $set: { dueAt: n.dueAt, contextNote: n.contextNote, status: 'open', missedAt: null, escalatedAt: null } });
    await this.r.leads.updateOne({ _id: t.leadId }, { $set: { nextActionAt: await this.earliestOpenDue(t.leadId) } });
    await this.activity(t.leadId, 'task_created', { taskId: String(t._id), rescheduled: true, dueAt: n.dueAt, note: n.contextNote });
    return this.getTask(id);
  }

  async cancelTask(id: string) {
    const t = await this.getTask(id);
    await this.r.tasks.updateOne({ _id: t._id }, { $set: { status: 'cancelled' } });
    await this.r.leads.updateOne({ _id: t.leadId }, { $set: { nextActionAt: await this.earliestOpenDue(t.leadId) } });
  }

  listTasks(f: { assigneeId?: string; leadId?: string; status?: string }) {
    const filter: Record<string, unknown> = {};
    if (f.assigneeId) filter.assigneeId = toObjectId(f.assigneeId);
    if (f.leadId) filter.leadId = toObjectId(f.leadId);
    if (f.status) filter.status = f.status;
    return this.r.tasks.find(filter, { sort: { dueAt: 1 }, limit: 200 });
  }

  // ---------------- calls ----------------
  /** Tap-to-call (no telephony account): the session exists from the moment the agent taps Call. */
  async startCall(leadId: string) {
    const lead: any = await this.leads.get(leadId);
    const agent = this.actor();
    const pending: any = await this.r.callSessions.findOne({ agentId: toObjectId(agent), outcomeId: null, outcomeLoggedAt: null, state: { $in: ['dialed', 'ended'] } });
    if (pending) throw new DomainError('outcome_pending', 'Log the outcome of your previous call first', { callSessionId: String(pending._id) }, 409);
    const phone = lead.contacts.find((c: any) => c.kind === 'phone' && !(c.optedOutChannels ?? []).includes('call')) ?? lead.contacts.find((c: any) => c.kind === 'phone');
    if (!phone) throw new DomainError('no_phone', 'This lead has no phone number');
    const s: any = await this.r.callSessions.create({ leadId: lead._id, agentId: toObjectId(agent), mode: 'tap', direction: 'out', state: 'dialed', startedAt: this.now(), durationSource: 'self_reported' });
    await this.presence.set(agent, 'on_call');
    await this.activity(lead._id, 'call_started', { callSessionId: String(s._id), mode: 'tap' });
    return { callSessionId: String(s._id), dialUri: `tel:${phone.valueNorm}` }; // reduced custody in tap mode (spec 11.6b)
  }

  /** Agent returns to the app: duration is prefilled from elapsed time and is labelled self-reported. */
  async endCall(callSessionId: string, o: { durationS?: number } = {}) {
    const s: any = await this.r.callSessions.findById(callSessionId);
    if (!s) throw notFound('Call');
    if (String(s.agentId) !== this.actor()) throw new DomainError('forbidden', 'Not your call', undefined, 403);
    const endedAt = this.now();
    const elapsed = Math.max(0, Math.round((endedAt.getTime() - new Date(s.startedAt).getTime()) / 1000));
    const durationS = Math.min(o.durationS ?? elapsed, 4 * 3600);
    await this.r.callSessions.updateOne({ _id: s._id, state: { $in: ['dialed', 'ringing', 'answered'] } }, { $set: { state: 'ended', endedAt, durationS } });
    await this.presence.set(this.actor(), 'online');
    return { callSessionId, durationS, suggestedDurationS: elapsed, durationSource: s.durationSource };
  }

  /** Skipping the outcome sheet is allowed a limited number of times per day; skips feed Pulse. */
  async skipOutcome(callSessionId: string) {
    const s: any = await this.r.callSessions.findById(callSessionId);
    if (!s || String(s.agentId) !== this.actor()) throw notFound('Call');
    if (s.outcomeLoggedAt) throw new DomainError('invalid_state', 'Outcome already logged');
    const max = (await this.settings()).maxOutcomeSkipsPerDay;
    const day = this.now().toISOString().slice(0, 10);
    const key = `outcome-skips:${this.actor()}:${day}`;
    const c: any = await this.r.counters.findOneAndUpdate({ key, seq: { $lt: max } }, { $inc: { seq: 1 }, $setOnInsert: { key } }, { new: true, upsert: true }).catch((e: any) => { if (e?.code === 11000) return null; throw e; });
    if (!c) throw new DomainError('skip_limit', `You can skip at most ${max} outcome sheets per day. Log this one.`, { max }, 429);
    await this.r.callSessions.updateOne({ _id: s._id }, { $inc: { outcomeSkips: 1 }, $set: { state: s.state === 'dialed' ? 'ended' : s.state } });
    await this.activity(s.leadId, 'field_changed', { changes: { outcomeSkipped: { from: null, to: callSessionId } } });
    return { skipsLeftToday: max - c.seq };
  }

  // ---------------- outcome sheet ----------------
  /** Task completion + outcome + status change + next action, atomically. */
  async logOutcome(i: { leadId: string; outcomeId: string; note?: string; callSessionId?: string; taskId?: string; durationS?: number; next?: NextAction; statusId?: string; lostReasonId?: string }) {
    const actor = this.actor();
    const now = this.now();
    return withTransaction(this.db.conn, async () => {
      const lead: any = await this.leads.get(i.leadId);
      const outcome: any = await this.r.outcomes.findOne({ _id: i.outcomeId, active: true });
      if (!outcome) throw notFound('Outcome');
      const next = outcome.requiresNextAction || i.next ? validateNextAction(i.next, now) : undefined;

      let session: any;
      if (i.callSessionId) {
        session = await this.r.callSessions.findById(i.callSessionId);
        if (!session || String(session.leadId) !== String(lead._id) || String(session.agentId) !== actor) throw notFound('Call');
        if (session.outcomeLoggedAt) throw new DomainError('invalid_state', 'Outcome already logged for this call');
      }

      let task: any;
      if (i.taskId) task = await this.getTask(i.taskId);
      else task = (await this.r.tasks.find({ leadId: lead._id, assigneeId: toObjectId(actor), status: { $in: ['open', 'missed'] }, dueAt: { $lte: now } }, { sort: { dueAt: 1 }, limit: 1 }))[0];
      if (task && task.status !== 'done') await this.completeTask(String(task._id));

      await this.activity(lead._id, 'call_ended', { outcomeId: String(outcome._id), outcome: outcome.label, kind: outcome.kind, note: i.note?.slice(0, 2000), callSessionId: i.callSessionId, durationS: session ? i.durationS ?? session.durationS : i.durationS, selfReported: session ? session.durationSource === 'self_reported' : true });
      const set: Record<string, unknown> = { lastContactedAt: now };
      if (!lead.firstContactedAt) set.firstContactedAt = now;
      await this.r.leads.updateOne({ _id: lead._id }, { $set: set });
      if (!lead.firstContactedAt) await this.sla.markContacted(lead._id); // first contact cancels the SLA timers
      if (session) await this.r.callSessions.updateOne({ _id: session._id }, { $set: { outcomeId: outcome._id, outcomeLoggedAt: now, state: 'ended', ...(i.durationS !== undefined ? { durationS: i.durationS } : {}) } });

      let created: any;
      if (next) created = await this.createTask({ leadId: i.leadId, next, outcomeId: outcome._id });
      if (i.statusId) await this.leads.changeStatus(i.leadId, i.statusId, { lostReasonId: i.lostReasonId });
      await this.r.outbox.add('outcome.logged', i.leadId, { outcomeId: String(outcome._id), kind: outcome.kind });

      let suggestedLostReasonId: string | undefined;
      if (outcome.suggestLostReasonLabel) suggestedLostReasonId = String(((await this.r.lostReasons.findOne({ label: outcome.suggestLostReasonLabel })) as any)?._id ?? '') || undefined;
      return { task: created ?? null, completedTaskId: task ? String(task._id) : null, suggestion: { statusId: outcome.suggestStatusId ? String(outcome.suggestStatusId) : null, lostReasonId: suggestedLostReasonId ?? null, nextOffsetMinutes: outcome.defaultNextOffsetMin ?? null } };
    });
  }

  // ---------------- Today queue ----------------
  async queue(userId: string, o: { limit?: number } = {}) {
    const now = this.now(); const me = toObjectId(userId);
    const s = await this.settings();
    const sources: any[] = await this.r.sources.find();
    const sourceName = new Map(sources.map((x) => [String(x._id), x]));
    const items: QueueItem[] = [];
    const leadCache = new Map<string, any>();
    const loadLeads = async (ids: unknown[]) => {
      const need = ids.filter((x) => !leadCache.has(String(x)));
      if (need.length) for (const l of (await this.r.leads.find({ _id: { $in: need }, deletedAt: null })) as any[]) leadCache.set(String(l._id), l);
    };

    // A. calls that ended (or were dialed) without an outcome: nothing else matters until resolved
    const pend: any[] = await this.r.callSessions.find({ agentId: me, outcomeLoggedAt: null, state: { $in: ['dialed', 'ended', 'answered'] } }, { sort: { startedAt: 1 }, limit: 20 });
    await loadLeads(pend.map((p) => p.leadId));
    for (const p of pend) {
      const l = leadCache.get(String(p.leadId)); if (!l) continue;
      items.push({ kind: 'outcome_pending', leadId: String(l._id), leadName: l.displayName, reason: 'Call ended without an outcome: log it to continue', priority: (now.getTime() - new Date(p.startedAt).getTime()) / 60_000, suggestedAction: { type: 'log_outcome' }, callSessionId: String(p._id) });
    }

    // B. new leads awaiting first contact (SLA-aware)
    const openIds = ((await this.r.statuses.find({ kind: 'open' })) as any[]).map((x) => x._id);
    const fresh: any[] = await this.r.leads.find({ ownerId: me, deletedAt: null, firstContactedAt: null, $or: [{ statusId: { $in: openIds } }, { statusId: null }] }, { sort: { _id: 1 }, limit: 200 });
    for (const l of fresh) {
      leadCache.set(String(l._id), l);
      const since = new Date(l.assignedAt ?? l.createdAt).getTime();
      const elapsed = Math.max(0, (now.getTime() - since) / 1000);
      const remaining = s.firstContactSeconds - elapsed;
      const boost = remaining <= 0 ? 200 + Math.min(-remaining / 60, 100) : 200 * (1 - remaining / s.firstContactSeconds);
      const src = sourceName.get(String(l.sourceId));
      const weight = src ? s.sourceWeights[src.kind] ?? 0 : 0;
      items.push({
        kind: 'new_lead', leadId: String(l._id), leadName: l.displayName, dueAt: new Date(since + s.firstContactSeconds * 1000),
        reason: ['New lead ' + ago(elapsed * 1000) + ' ago', src?.name, l.city].filter(Boolean).join(' · ') + (remaining <= 0 ? ' · SLA breached' : ''),
        priority: 100 + (l.score ?? 50) + boost + weight, suggestedAction: { type: 'call' },
      });
    }

    // C/D. tasks: overdue, then due within 30 minutes
    const soon = new Date(now.getTime() + 30 * 60_000);
    const tasks: any[] = await this.r.tasks.find({ assigneeId: me, status: { $in: ['open', 'missed'] }, dueAt: { $lte: soon } }, { sort: { dueAt: 1 }, limit: 200 });
    await loadLeads(tasks.map((t) => t.leadId));
    for (const t of tasks) {
      const l = leadCache.get(String(t.leadId)); if (!l) continue;
      const overdue = new Date(t.dueAt).getTime() < now.getTime();
      items.push(overdue
        ? { kind: 'overdue_task', leadId: String(l._id), leadName: l.displayName, dueAt: t.dueAt, taskId: String(t._id), reason: `Overdue ${ago(now.getTime() - new Date(t.dueAt).getTime())}: ${t.contextNote}`, priority: (now.getTime() - new Date(t.dueAt).getTime()) / 60_000, suggestedAction: { type: t.type } }
        : { kind: 'due_task', leadId: String(l._id), leadName: l.displayName, dueAt: t.dueAt, taskId: String(t._id), reason: `Due in ${ago(new Date(t.dueAt).getTime() - now.getTime())}: ${t.contextNote}`, priority: 1000 - (new Date(t.dueAt).getTime() - now.getTime()) / 60_000, suggestedAction: { type: t.type } });
    }

    // E. unread inbound replies arrive with conversations in Phase 4.

    // F. stale: open, owned, untouched for staleDays, nothing scheduled
    const cutoff = new Date(now.getTime() - s.staleDays * 86_400_000);
    const have = new Set(items.map((x) => x.leadId));
    const stale: any[] = await this.r.leads.find({ ownerId: me, deletedAt: null, nextActionAt: null, firstContactedAt: { $ne: null }, lastContactedAt: { $lt: cutoff }, $or: [{ statusId: { $in: openIds } }, { statusId: null }] }, { sort: { lastContactedAt: 1 }, limit: 100 });
    for (const l of stale) if (!have.has(String(l._id))) items.push({ kind: 'stale', leadId: String(l._id), leadName: l.displayName, reason: `No contact for ${ago(now.getTime() - new Date(l.lastContactedAt).getTime())}`, priority: (now.getTime() - new Date(l.lastContactedAt).getTime()) / 86_400_000, suggestedAction: { type: 'call' } });

    items.sort((a, b) => TIER[a.kind] - TIER[b.kind] || b.priority - a.priority);
    const counts = items.reduce((m, x) => ({ ...m, [x.kind]: (m[x.kind] ?? 0) + 1 }), {} as Record<string, number>);
    return { items: items.slice(0, Math.min(o.limit ?? 50, 200)), counts, total: items.length, caughtUp: items.length === 0 };
  }

  // ---------------- sweeper (missed + escalation) ----------------
  /** Runs inside a tenant context. Returns what happened so callers/tests can assert it. */
  async processOverdue(taskId: string): Promise<'missed' | 'skip'> {
    const t: any = await this.r.tasks.findById(taskId);
    if (!t || t.status !== 'open') return 'skip';
    if (new Date(t.dueAt).getTime() + (t.graceMinutes ?? 15) * 60_000 > this.now().getTime()) return 'skip';
    const r = await this.r.tasks.updateOne({ _id: t._id, status: 'open' }, { $set: { status: 'missed', missedAt: this.now() } });
    if (r.modifiedCount !== 1) return 'skip'; // another sweeper got it
    await this.activity(t.leadId, 'task_missed', { taskId: String(t._id), dueAt: t.dueAt, note: t.contextNote });
    const lead: any = await this.r.leads.findById(t.leadId);
    const payload = { taskId: String(t._id), leadId: String(t.leadId), leadName: lead?.displayName, dueAt: t.dueAt, note: t.contextNote, assigneeId: String(t.assigneeId) };
    await this.notifier.notify({ kind: 'task.missed', audience: 'user', userId: t.assigneeId, payload, dedupeKey: `task-missed:user:${t._id}` });
    await this.notifier.notify({ kind: 'task.missed', audience: 'managers', payload, dedupeKey: `task-missed:mgr:${t._id}` });
    await this.r.outbox.add('task.missed', String(t._id), payload);
    return 'missed';
  }

  async escalate(taskId: string): Promise<boolean> {
    const t: any = await this.r.tasks.findById(taskId);
    if (!t || t.status !== 'missed' || t.escalatedAt) return false;
    const s = await this.settings();
    if (new Date(t.missedAt).getTime() + s.escalateAfterHours * 3_600_000 > this.now().getTime()) return false;
    const r = await this.r.tasks.updateOne({ _id: t._id, escalatedAt: null }, { $set: { escalatedAt: this.now() } });
    if (r.modifiedCount !== 1) return false;
    const lead: any = await this.r.leads.findById(t.leadId);
    await this.notifier.notify({ kind: 'task.escalated', audience: 'managers', payload: { taskId: String(t._id), leadId: String(t.leadId), leadName: lead?.displayName, missedAt: t.missedAt, assigneeId: String(t.assigneeId) }, dedupeKey: `task-escalated:${t._id}` });
    if (s.autoReassignOnEscalation && lead) await this.leads.assign(String(lead._id), null); // back to the manager pool
    await this.r.outbox.add('task.escalated', String(t._id), {});
    return true;
  }

  /** Cross-tenant sweep driven by the worker; each task is handled inside its own tenant scope. */
  async sweepAll(sys: SystemOps): Promise<{ missed: number; escalated: number }> {
    const now = this.now();
    let missed = 0, escalated = 0;
    for (const c of (await sys.overdueTasks(now)) as any[]) {
      if (new Date(c.dueAt).getTime() + (c.graceMinutes ?? 15) * 60_000 > now.getTime()) continue;
      if ((await runWithTenant(String(c.tenantId), () => new DoService(this.db, this.now, this.notifier).processOverdue(String(c._id)))) === 'missed') missed++;
    }
    for (const c of (await sys.escalatableTasks(new Date(now.getTime() - 60_000))) as any[]) {
      if (await runWithTenant(String(c.tenantId), () => new DoService(this.db, this.now, this.notifier).escalate(String(c._id)))) escalated++;
    }
    return { missed, escalated };
  }
}
