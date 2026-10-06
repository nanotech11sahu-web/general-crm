import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { requireTenantId, runWithTenant, toObjectId, type SystemOps, type TenantDb } from '@leaddesk/db';
import { CadenceEnroller, type FirstTouchSettings, type StepInput, type StopOn, type StopReason } from './cadence-enroll';
import { BillingService } from './billing';
import { DoService } from './do';
import { DomainError, notFound } from './errors';
import { MessagingService } from './messaging';
import { inTimeWindow } from './routing';

export * from './cadence-enroll';
const DEFAULT_STOP: StopOn = { inboundReply: true, connectedCall: true, statusChange: true, optOut: true };

/** Executes due steps. Every send goes through MessagingService (consent, windows, DLT, quiet hours, frequency cap). */
export class CadenceService extends CadenceEnroller {
  private readonly msg: MessagingService;
  private readonly doSvc: DoService;
  constructor(db: TenantDb, keys: KeyService, registry: ConnectorRegistry, now: () => Date = () => new Date()) {
    super(db, now);
    this.msg = new MessagingService(db, keys, registry, now);
    this.doSvc = new DoService(db, now);
  }

  // ---------- definitions ----------
  private async validateSteps(steps: StepInput[]) {
    const errors: Record<string, string> = {};
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 10) errors.steps = 'a cadence needs 1 to 10 steps';
    let last = -1;
    (steps ?? []).forEach((s, i) => {
      if (!Number.isFinite(s.offsetMinutes) || s.offsetMinutes < 0 || s.offsetMinutes > 60 * 24 * 60) errors[`steps.${i}.offsetMinutes`] = 'between 0 and 60 days';
      else if (s.offsetMinutes < last) errors[`steps.${i}.offsetMinutes`] = 'steps must be in time order';
      last = Math.max(last, s.offsetMinutes);
    });
    for (const [i, s] of (steps ?? []).entries()) {
      if (s.action === 'message') {
        if (s.channel !== 'whatsapp' && s.channel !== 'sms') errors[`steps.${i}.channel`] = 'whatsapp or sms';
        else if (!s.templateId || !(await this.r.templates.findOne({ _id: s.templateId, channel: s.channel }))) errors[`steps.${i}.templateId`] = 'pick an existing template for this channel';
      } else if (s.action === 'task') {
        if (String(s.note ?? '').trim().split(/\s+/).length < 2 || String(s.note).trim().length < 10) errors[`steps.${i}.note`] = 'say what to do and why (at least 10 characters)';
      } else errors[`steps.${i}.action`] = 'task or message';
    }
    if (Object.keys(errors).length) throw new DomainError('invalid_cadence', 'Cadence is not valid', errors);
  }
  list() { return this.r.cadences.find({}, { sort: { name: 1 }, limit: 200 }); }
  async create(i: { name: string; steps: StepInput[]; stopOn?: Partial<StopOn>; enrollOn?: { statusIds?: string[]; outcomeIds?: string[] } }) {
    await this.validateSteps(i.steps);
    try {
      return await this.r.cadences.create({ name: i.name.trim(), steps: i.steps.map((s) => ({ ...s, templateId: s.templateId ? toObjectId(s.templateId) : undefined })), stopOn: { ...DEFAULT_STOP, ...(i.stopOn ?? {}) }, enrollOn: i.enrollOn ?? {}, active: true });
    } catch (e: any) { if (e?.code === 11000) throw new DomainError('duplicate_name', 'A cadence with this name already exists', undefined, 409); throw e; }
  }
  async update(id: string, i: Partial<{ name: string; steps: StepInput[]; stopOn: Partial<StopOn>; enrollOn: { statusIds?: string[]; outcomeIds?: string[] }; active: boolean }>) {
    const c: any = await this.r.cadences.findById(id);
    if (!c) throw notFound('Cadence');
    const set: Record<string, unknown> = {};
    if (i.steps) { await this.validateSteps(i.steps); set.steps = i.steps.map((s) => ({ ...s, templateId: s.templateId ? toObjectId(s.templateId) : undefined })); } // running enrollments keep their materialised steps
    if (i.name !== undefined) set.name = i.name.trim();
    if (i.stopOn) set.stopOn = { ...DEFAULT_STOP, ...(c.stopOn ?? {}), ...i.stopOn };
    if (i.enrollOn) set.enrollOn = i.enrollOn;
    if (i.active !== undefined) set.active = i.active;
    await this.r.cadences.updateOne({ _id: c._id }, { $set: set });
    return this.r.cadences.findById(id);
  }
  async setFirstTouch(i: FirstTouchSettings) {
    if (i.enabled) {
      if (i.channel !== 'whatsapp' && i.channel !== 'sms') throw new DomainError('invalid_first_touch', 'Pick whatsapp or sms');
      const t: any = await this.r.templates.findById(i.templateId);
      if (!t || t.channel !== i.channel) throw new DomainError('invalid_first_touch', 'Pick an existing template for that channel');
      if (t.status !== 'approved') throw new DomainError('invalid_first_touch', 'The template must be approved before it can be used automatically');
    }
    const v = { enabled: !!i.enabled, channel: i.channel, templateId: i.templateId ? toObjectId(i.templateId) : undefined, delayMinutes: Math.min(Math.max(Number(i.delayMinutes) || 0, 0), 24 * 60) };
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { 'settings.firstTouch': v } });
    return { ...v, templateId: i.templateId };
  }
  forLead(leadId: string) { return this.r.enrollments.find({ leadId: toObjectId(leadId) }, { sort: { createdAt: -1 }, limit: 50 }); }
  async stopEnrollment(id: string) {
    const e: any = await this.r.enrollments.findById(id);
    if (!e) throw notFound('Enrollment');
    await this.r.enrollments.updateOne({ _id: e._id, state: 'active' }, { $set: { state: 'stopped', stoppedReason: 'manual', nextRunAt: null } });
    return { ok: true };
  }

  // ---------- execution ----------
  /** The latest of "local quiet window ends", scanning forward in 10-minute steps (max 24 h). */
  private async afterQuietHours(): Promise<Date> {
    const s = await this.msg.settings();
    if (!s.quietHours) return new Date(this.now().getTime() + 10 * 60_000);
    for (let m = 10; m <= 24 * 60; m += 10) { const d = new Date(this.now().getTime() + m * 60_000); if (!inTimeWindow(d, s.tz, s.quietHours.from, s.quietHours.to)) return d; }
    return new Date(this.now().getTime() + 24 * 3600_000);
  }

  private async stopReason(e: any, lead: any): Promise<StopReason | null> {
    if (lead.deletedAt) return 'lead_deleted';
    const so: StopOn = { ...DEFAULT_STOP, ...(e.stopOn ?? {}) };
    const since = new Date(e.createdAt);
    const st: any = lead.statusId ? await this.r.statuses.findById(lead.statusId) : null;
    if (st && st.kind !== 'open') return 'lead_closed';
    if (e.kind === 'first_touch' && lead.firstContactedAt) return 'contacted'; // a human already reached out
    if (so.inboundReply && (await this.r.conversations.findOne({ leadId: lead._id, lastInboundAt: { $gte: since } }))) return 'reply';
    if (so.connectedCall && (await this.r.activities.findOne({ leadId: lead._id, type: 'call_ended', 'payload.kind': 'connected', occurredAt: { $gte: since } }))) return 'connected_call';
    if (so.statusChange && (await this.r.activities.findOne({ leadId: lead._id, type: 'status_changed', occurredAt: { $gt: since } }))) return 'status_change';
    return null;
  }

  private async finishStep(e: any, idx: number, result: string) {
    const last = idx + 1 >= e.steps.length;
    const next = last ? null : new Date(Math.max(new Date(e.steps[idx + 1].runAt).getTime(), this.now().getTime()));
    await this.r.enrollments.updateOne({ _id: e._id, state: 'active', stepIndex: idx }, { $set: { [`steps.${idx}.done`]: true, [`steps.${idx}.result`]: result, stepIndex: idx + 1, attempts: 0, nextRunAt: next, state: last ? 'completed' : 'active' } });
  }

  /** Runs inside a tenant context. */
  async runDue(enrollmentId: string): Promise<'sent' | 'task' | 'deferred' | 'skipped' | 'stopped' | 'idle'> {
    const e: any = await this.r.enrollments.findOne({ _id: enrollmentId, state: 'active', nextRunAt: { $lte: this.now() } });
    if (!e) return 'idle';
    if (await new BillingService(this.db, this.now).restricted()) return 'idle'; // read-only workspace: automation pauses (enrollments wait, nothing is lost)
    const lead: any = await this.r.leads.findOne({ _id: e.leadId });
    const why = lead ? await this.stopReason(e, lead) : 'lead_deleted';
    if (why) { await this.r.enrollments.updateOne({ _id: e._id, state: 'active' }, { $set: { state: 'stopped', stoppedReason: why, nextRunAt: null } }); if (lead) await this.r.activities.create({ leadId: lead._id, type: 'cadence_stopped', payload: { enrollmentId: String(e._id), kind: e.kind, reason: why }, occurredAt: this.now() }); return 'stopped'; }
    const idx = e.stepIndex; const step = e.steps[idx];
    if (!step) { await this.r.enrollments.updateOne({ _id: e._id }, { $set: { state: 'completed', nextRunAt: null } }); return 'idle'; }

    if (step.action === 'task') {
      if (!lead.ownerId) { await this.finishStep(e, idx, 'skipped:no_owner'); return 'skipped'; }
      try {
        await this.doSvc.createTask({ leadId: String(lead._id), assigneeId: String(lead.ownerId), next: { dueAt: new Date(this.now().getTime() + 60_000), contextNote: step.note, type: step.taskType ?? 'call' } });
        await this.finishStep(e, idx, 'task_created'); return 'task';
      } catch (err: any) { if (err instanceof DomainError) { await this.finishStep(e, idx, `skipped:${err.code}`); return 'skipped'; } throw err; }
    }

    try {
      await this.msg.send({ leadId: String(lead._id), channel: step.channel, templateId: String(step.templateId), idempotencyKey: `enr:${e._id}:${idx}`, source: e.kind === 'first_touch' ? 'first_touch' : 'cadence' });
      await this.finishStep(e, idx, 'sent'); return 'sent';
    } catch (err: any) {
      if (err instanceof DomainError) {
        if (err.code === 'quiet_hours') { await this.r.enrollments.updateOne({ _id: e._id }, { $set: { nextRunAt: await this.afterQuietHours() } }); return 'deferred'; }
        if (err.code === 'frequency_cap') { await this.r.enrollments.updateOne({ _id: e._id }, { $set: { nextRunAt: new Date(this.now().getTime() + 3600_000) } }); return 'deferred'; }
        if (err.code === 'opted_out' && e.stopOn?.optOut !== false) { await this.r.enrollments.updateOne({ _id: e._id, state: 'active' }, { $set: { state: 'stopped', stoppedReason: 'opt_out', nextRunAt: null } }); return 'stopped'; }
        await this.finishStep(e, idx, `skipped:${err.code}`); return 'skipped'; // a rejected/ineligible message is never retried
      }
      const attempts = (e.attempts ?? 0) + 1; // transport trouble: retry the same idempotency key a few times
      if (attempts >= 5) { await this.finishStep(e, idx, 'skipped:transport_error'); return 'skipped'; }
      await this.r.enrollments.updateOne({ _id: e._id }, { $set: { attempts, nextRunAt: new Date(this.now().getTime() + attempts * 5 * 60_000) } });
      return 'deferred';
    }
  }

  /** Worker entry: due enrollments across tenants, each processed inside its own tenant context. */
  async sweepAll(sys: SystemOps, limit = 200) {
    const out = { sent: 0, task: 0, deferred: 0, skipped: 0, stopped: 0, idle: 0 };
    for (const c of (await sys.dueEnrollments(this.now(), limit)) as any[]) {
      try { out[await runWithTenant(String(c.tenantId), () => this.runDue(String(c._id)))]++; } catch { out.deferred++; } // one bad enrollment must not stall the rest
    }
    return out;
  }
}
