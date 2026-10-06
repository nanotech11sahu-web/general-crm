import { requireTenantId, toObjectId, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';

import type { Channel } from './messaging';

export type StopReason = 'reply' | 'connected_call' | 'status_change' | 'opt_out' | 'contacted' | 'lead_closed' | 'lead_deleted' | 'manual';
export interface StepInput { offsetMinutes: number; action: 'task' | 'message'; channel?: Channel; templateId?: string; taskType?: 'call' | 'whatsapp' | 'sms' | 'visit' | 'other'; note?: string }
export interface StopOn { inboundReply: boolean; connectedCall: boolean; statusChange: boolean; optOut: boolean }
export interface FirstTouchSettings { enabled: boolean; channel: Channel; templateId: string; delayMinutes: number }

const STOP_FLAG: Record<'reply' | 'connected_call' | 'status_change' | 'opt_out', keyof StopOn> = { reply: 'inboundReply', connected_call: 'connectedCall', status_change: 'statusChange', opt_out: 'optOut' };
const DEFAULT_STOP: StopOn = { inboundReply: true, connectedCall: true, statusChange: true, optOut: true };
/** Leads that came in *because they messaged us* are already in conversation: no automated opener. */
const NO_FIRST_TOUCH_SOURCES = new Set(['manual', 'import', 'api', 'demo', 'whatsapp', 'whatsapp-cloud', 'sms', 'sms-msg91']);

/** DB-only half: enrolling and stopping. Safe to call from LeadService/DoService/MessagingService without a cycle. */
export class CadenceEnroller {
  constructor(protected readonly db: TenantDb, protected readonly now: () => Date = () => new Date()) {}
  protected get r() { return this.db.repos; }

  async firstTouchSettings(): Promise<FirstTouchSettings | null> {
    const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec();
    const f = t?.settings?.firstTouch;
    return f?.enabled && f.templateId ? { enabled: true, channel: f.channel, templateId: String(f.templateId), delayMinutes: Number(f.delayMinutes ?? 0) } : null;
  }

  private build(steps: StepInput[], at: Date) {
    return steps.map((s) => ({ runAt: new Date(at.getTime() + s.offsetMinutes * 60_000), action: s.action, channel: s.channel, templateId: s.templateId ? toObjectId(s.templateId) : undefined, taskType: s.taskType, note: s.note, done: false }));
  }

  /** Re-enrolling a finished enrollment restarts it; an active one is left alone. */
  private async upsert(leadId: unknown, dedupeKey: string, doc: { cadenceId?: unknown; kind: 'cadence' | 'first_touch'; stopOn: StopOn; steps: StepInput[] }): Promise<{ enrollmentId: string; created: boolean } | null> {
    const at = this.now();
    const steps = this.build(doc.steps, at);
    if (!steps.length) return null;
    const live: any = await this.r.enrollments.findOne({ leadId, dedupeKey });
    if (live?.state === 'active') return { enrollmentId: String(live._id), created: false };
    if (live) {
      await this.r.enrollments.updateOne({ _id: live._id, state: { $ne: 'active' } }, { $set: { steps, stepIndex: 0, attempts: 0, state: 'active', nextRunAt: steps[0].runAt, stoppedReason: null, stopOn: doc.stopOn, createdAt: at } });
      return { enrollmentId: String(live._id), created: true };
    }
    try {
      const e: any = await this.r.enrollments.create({ leadId, cadenceId: doc.cadenceId, dedupeKey, kind: doc.kind, stopOn: doc.stopOn, steps, stepIndex: 0, state: 'active', nextRunAt: steps[0].runAt });
      return { enrollmentId: String(e._id), created: true };
    } catch (e: any) { if (e?.code === 11000) return null; throw e; }
  }

  async enroll(leadId: string, cadenceId: string) {
    const c: any = await this.r.cadences.findById(cadenceId);
    if (!c) throw notFound('Cadence');
    if (!c.active) throw new DomainError('cadence_inactive', 'This cadence is switched off', undefined, 409);
    const lead: any = await this.r.leads.findOne({ _id: leadId, deletedAt: null });
    if (!lead) throw notFound('Lead');
    const r = await this.upsert(lead._id, `cadence:${c._id}`, { cadenceId: c._id, kind: 'cadence', stopOn: { ...DEFAULT_STOP, ...(c.stopOn ?? {}) }, steps: c.steps });
    return r ?? { enrollmentId: null, created: false };
  }

  /** Called from intake for brand-new leads only (never re-enquiries). */
  async enrollFirstTouch(lead: any, sourceKind?: string) {
    if (sourceKind && NO_FIRST_TOUCH_SOURCES.has(sourceKind)) return null;
    const s = await this.firstTouchSettings();
    if (!s || !(lead.contacts ?? []).some((c: any) => c.kind === 'phone' && !(c.optedOutChannels ?? []).includes(s.channel))) return null;
    return this.upsert(lead._id, 'first_touch', { kind: 'first_touch', stopOn: { ...DEFAULT_STOP }, steps: [{ offsetMinutes: s.delayMinutes, action: 'message', channel: s.channel, templateId: s.templateId }] });
  }

  /** Auto-enrol into cadences whose `enrollOn` matches what just happened. */
  async autoEnroll(leadId: unknown, ev: { statusId?: string; outcomeId?: string }) {
    const cads: any[] = await this.r.cadences.find({ active: true });
    for (const c of cads) {
      const on = c.enrollOn ?? {};
      const hit = (ev.statusId && (on.statusIds ?? []).map(String).includes(ev.statusId)) || (ev.outcomeId && (on.outcomeIds ?? []).map(String).includes(ev.outcomeId));
      if (hit) await this.upsert(leadId, `cadence:${c._id}`, { cadenceId: c._id, kind: 'cadence', stopOn: { ...DEFAULT_STOP, ...(c.stopOn ?? {}) }, steps: c.steps });
    }
  }

  /** Eager stop (the runner re-checks before every step too, so a missed call here can never cause an unwanted send). */
  async stopFor(leadId: unknown, reason: StopReason, o: { except?: string[] } = {}) {
    const flag = (STOP_FLAG as Record<string, keyof StopOn>)[reason];
    const live: any[] = await this.r.enrollments.find({ leadId, state: 'active' });
    let n = 0;
    for (const e of live) {
      if (o.except?.includes(String(e._id))) continue;
      if (flag && e.stopOn && e.stopOn[flag] === false) continue;
      const u = await this.r.enrollments.updateOne({ _id: e._id, state: 'active' }, { $set: { state: 'stopped', stoppedReason: reason, nextRunAt: null } });
      if (u.modifiedCount === 1) { n++; await this.r.activities.create({ leadId, type: 'cadence_stopped', payload: { enrollmentId: String(e._id), kind: e.kind, reason }, occurredAt: this.now() }); }
    }
    return n;
  }
}

