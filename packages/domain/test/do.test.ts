import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSystemOps, migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { DoService, LeadService, seedPreset, validateNextAction } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let sys: any; let lead: LeadService;
let T: string; let T2: string; let AG: string; let AG2: string; let MG: string;
let clock = new Date('2026-03-10T06:30:00Z');
const now = () => clock;
const notes: any[] = [];
const notifier = { notify: async (n: any) => { notes.push(n); } };
const svc = () => new DoService(db, now, notifier);
const as = <TT>(t: string, user: string, fn: () => Promise<TT>) => runWithTenant(t, fn, { userId: user });
const mins = (m: number) => new Date(clock.getTime() + m * 60_000);

async function mkUser(t: string, role: string) {
  const u: any = await db.models.User.create({ email: `${role}-${Math.random()}@x.io`, name: role });
  await runWithTenant(t, () => db.repos.memberships.create({ userId: u._id, role }));
  return String(u._id);
}
async function mkLead(t: string, user: string, name: string, phone: string, owner?: string, extra: any = {}) {
  const r: any = await as(t, user, () => lead.intake({ name, contacts: [{ value: phone }], ownerId: owner, source: { kind: 'meta', name: 'Meta' }, city: 'Pune' }));
  if (Object.keys(extra).length) await as(t, user, () => db.repos.leads.updateOne({ _id: r.leadId }, { $set: extra }));
  return r.leadId as string;
}
const outcomeId = async (t: string, label: string) => String(((await runWithTenant(t, () => db.repos.outcomes.findOne({ label }))) as any)._id);

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('do_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); sys = createSystemOps(db.models); lead = new LeadService(db);
  const mk = async (slug: string) => {
    const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN' }));
    await runWithTenant(String(t._id), () => seedPreset(db.repos, 'real_estate'));
    return String(t._id);
  };
  T = await mk('t1'); T2 = await mk('t2');
  AG = await mkUser(T, 'agent'); AG2 = await mkUser(T, 'agent'); MG = await mkUser(T, 'manager');
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('next-action validation', () => {
  it('requires a real future time and a useful note', () => {
    const ok = validateNextAction({ dueAt: mins(60), contextNote: 'Asked to call Friday after 6 PM about 3BHK' }, clock);
    expect(ok.type).toBe('call');
    for (const note of ['', 'call', 'follow up', 'callback', 'ok ok', 'short']) expect(() => validateNextAction({ dueAt: mins(60), contextNote: note }, clock)).toThrow(/useful note/);
    expect(() => validateNextAction({ dueAt: mins(-5), contextNote: 'Call him tomorrow morning' }, clock)).toThrow();
    expect(() => validateNextAction({ dueAt: 'garbage' as any, contextNote: 'Call him tomorrow morning' }, clock)).toThrow();
    expect(() => validateNextAction({ dueAt: new Date(clock.getTime() + 400 * 86400_000), contextNote: 'Call him next year please' }, clock)).toThrow(expect.objectContaining({ details: { dueAt: expect.stringMatching(/within a year/) } }));
    expect(() => validateNextAction(undefined, clock)).toThrow();
  });
});

describe('outcome sheet', () => {
  it('logs outcome + next task atomically; completes the due task; sets first contact; suggests status', async () => {
    const id = await mkLead(T, AG, 'Outcome Lead', '9300000001', AG);
    const due = await as(T, AG, () => svc().createTask({ leadId: id, next: { dueAt: mins(60), contextNote: 'Initial call about site visit' } }));
    clock = mins(70); // task is now due
    const o = await outcomeId(T, 'Connected - Interested');
    await expect(as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: o }))).rejects.toMatchObject({ code: 'invalid_next_action' }); // requires next action
    const res = await as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: o, note: 'Wants 3BHK', next: { dueAt: mins(24 * 60), contextNote: 'Share brochure and confirm site visit slot' } }));
    expect(res.completedTaskId).toBe(String(due._id));
    expect(res.task.status).toBe('open');
    expect(res.suggestion.nextOffsetMinutes).toBe(1440);
    expect(res.suggestion.statusId).toBeTruthy();
    const l: any = await as(T, AG, () => lead.get(id));
    expect(l.firstContactedAt).toBeTruthy();
    expect(new Date(l.nextActionAt).getTime()).toBe(mins(24 * 60).getTime());
    const types = (await as(T, AG, () => lead.timeline(id))).items.map((a: any) => a.type);
    expect(types).toEqual(expect.arrayContaining(['call_ended', 'task_created', 'task_done']));
    expect(((await as(T, AG, () => db.repos.tasks.findById(due._id))) as any).status).toBe('done');
  });
  it('a failed validation rolls everything back (no half-logged call)', async () => {
    const id = await mkLead(T, AG, 'Atomic Lead', '9300000002', AG);
    const before = await as(T, AG, () => db.repos.activities.count({ leadId: id }));
    await expect(as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: await outcomeId(T, 'Not Reachable'), next: { dueAt: mins(-10), contextNote: 'Try again tomorrow morning' } }))).rejects.toThrow();
    expect(await as(T, AG, () => db.repos.activities.count({ leadId: id }))).toBe(before);
    expect(((await as(T, AG, () => lead.get(id))) as any).firstContactedAt).toBeFalsy();
  });
  it('outcomes without a required next action need none; dead outcomes suggest lost + reason', async () => {
    const id = await mkLead(T, AG, 'Wrong Num', '9300000003', AG);
    const res = await as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: await outcomeId(T, 'Wrong Number') }));
    expect(res.task).toBeNull();
    expect(res.suggestion.lostReasonId).toBeTruthy();
    const lost: any = await as(T, AG, () => db.repos.statuses.findOne({ kind: 'lost' }));
    expect(res.suggestion.statusId).toBe(String(lost._id));
    // applying the status in the same sheet enforces the lost-reason rule
    const id2 = await mkLead(T, AG, 'Lost Via Sheet', '9300000004', AG);
    const o = await outcomeId(T, 'Connected - Not Interested');
    await expect(as(T, AG, async () => svc().logOutcome({ leadId: id2, outcomeId: o, statusId: String(lost._id) }))).rejects.toMatchObject({ code: 'status_requirements_not_met' });
    await as(T, AG, async () => svc().logOutcome({ leadId: id2, outcomeId: o, statusId: String(lost._id), lostReasonId: res.suggestion.lostReasonId! }));
    expect(String(((await as(T, AG, () => lead.get(id2))) as any).statusId)).toBe(String(lost._id));
  });
  it("another tenant's outcome/lead cannot be used", async () => {
    const id = await mkLead(T, AG, 'Iso Lead', '9300000005', AG);
    const foreign = await outcomeId(T2, 'Busy');
    await expect(as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: foreign, next: { dueAt: mins(200), contextNote: 'Call back this evening please' } }))).rejects.toThrow('Outcome not found');
    const other = await mkUser(T2, 'agent');
    await expect(as(T2, other, async () => svc().logOutcome({ leadId: id, outcomeId: foreign }))).rejects.toThrow('Lead not found');
  });
});

describe('call sessions and forced outcomes', () => {
  it('dial -> end -> must log outcome before dialing again; session shows at top of Today; skips are capped per day', async () => {
    const a = await mkLead(T, AG2, 'Dial A', '9400000001', AG2); const b = await mkLead(T, AG2, 'Dial B', '9400000002', AG2);
    const call = await as(T, AG2, () => svc().startCall(a));
    expect(call.dialUri).toBe('tel:+919400000001');
    clock = mins(3);
    const end = await as(T, AG2, () => svc().endCall(call.callSessionId));
    expect(end).toMatchObject({ durationS: 180, durationSource: 'self_reported' });
    await expect(as(T, AG2, () => svc().startCall(b))).rejects.toMatchObject({ code: 'outcome_pending' });
    const q = await as(T, AG2, () => svc().queue(AG2));
    expect(q.items[0]).toMatchObject({ kind: 'outcome_pending', leadName: 'Dial A', callSessionId: call.callSessionId });
    // skip budget: 3/day
    await as(T, AG2, () => svc().skipOutcome(call.callSessionId));
    await as(T, AG2, () => svc().skipOutcome(call.callSessionId));
    expect((await as(T, AG2, () => svc().skipOutcome(call.callSessionId))).skipsLeftToday).toBe(0);
    await expect(as(T, AG2, () => svc().skipOutcome(call.callSessionId))).rejects.toMatchObject({ code: 'skip_limit', status: 429 });
    // a skipped session still blocks until resolved
    await expect(as(T, AG2, () => svc().startCall(b))).rejects.toMatchObject({ code: 'outcome_pending' });
    await as(T, AG2, async () => svc().logOutcome({ leadId: a, outcomeId: '' + (await outcomeId(T, 'Wrong Number')), callSessionId: call.callSessionId, durationS: 20 }));
    expect(((await as(T, AG2, () => db.repos.callSessions.findById(call.callSessionId))) as any)).toMatchObject({ durationS: 20, durationSource: 'self_reported', outcomeSkips: 3 });
    await as(T, AG2, () => svc().startCall(b)); // free again
  });
  it("an agent cannot end or skip someone else's call; no phone => clear error", async () => {
    const id = await mkLead(T, AG, 'Mine', '9400000010', AG);
    const call = await as(T, AG, () => svc().startCall(id));
    await expect(as(T, AG2, () => svc().endCall(call.callSessionId))).rejects.toMatchObject({ status: 403 });
    await expect(as(T, AG2, () => svc().skipOutcome(call.callSessionId))).rejects.toThrow('Call not found');
    const emailOnly: any = await as(T, AG, () => lead.intake({ name: 'Email', contacts: [{ value: 'only@x.io' }], ownerId: AG }));
    await as(T, AG, () => svc().endCall(call.callSessionId));
    await as(T, AG, async () => svc().logOutcome({ leadId: id, outcomeId: '' + (await outcomeId(T, 'Wrong Number')), callSessionId: call.callSessionId }));
    await expect(as(T, AG, () => svc().startCall(emailOnly.leadId))).rejects.toMatchObject({ code: 'no_phone' });
  });
});

describe('Today queue', () => {
  it('orders: outcome pending > new leads (SLA/score) > overdue (oldest) > due soon > stale; explains each item', async () => {
    const U = await mkUser(T, 'agent');
    clock = new Date('2026-03-10T10:00:00Z');
    const stale = await mkLead(T, U, 'Stale One', '9500000001', U, { firstContactedAt: mins(-60 * 24 * 20), lastContactedAt: mins(-60 * 24 * 10), nextActionAt: null });
    const fresh = await mkLead(T, U, 'Fresh Cold', '9500000002', U, { assignedAt: mins(-2), score: 20 });
    const hot = await mkLead(T, U, 'Fresh Hot', '9500000003', U, { assignedAt: mins(-2), score: 95 });
    const breached = await mkLead(T, U, 'SLA Breached', '9500000004', U, { assignedAt: mins(-40), score: 10 });
    const contacted = await mkLead(T, U, 'Task Lead A', '9500000005', U, { firstContactedAt: mins(-500) });
    const contacted2 = await mkLead(T, U, 'Task Lead B', '9500000006', U, { firstContactedAt: mins(-500) });
    const contacted3 = await mkLead(T, U, 'Task Lead C', '9500000007', U, { firstContactedAt: mins(-500) });
    const mkTask = async (leadId: string, dueMin: number, note: string) => {
      const keep = clock; clock = mins(dueMin - 120); // create "in the past" so the due time is valid then
      const t = await as(T, U, () => svc().createTask({ leadId, next: { dueAt: new Date(keep.getTime() + dueMin * 60_000), contextNote: note } }));
      clock = keep; return t;
    };
    await mkTask(contacted, -300, 'Old overdue about brochure');
    await mkTask(contacted2, -30, 'Recent overdue about visit');
    await mkTask(contacted3, 20, 'Upcoming call about pricing');
    const pendingLead = await mkLead(T, U, 'Pending Outcome', '9500000008', U, { firstContactedAt: mins(-5) });
    await as(T, U, () => svc().startCall(pendingLead));

    const q = await as(T, U, () => svc().queue(U));
    expect(q.items.map((i) => i.leadName)).toEqual(['Pending Outcome', 'SLA Breached', 'Fresh Hot', 'Fresh Cold', 'Task Lead A', 'Task Lead B', 'Task Lead C', 'Stale One']);
    expect(q.items.map((i) => i.kind)).toEqual(['outcome_pending', 'new_lead', 'new_lead', 'new_lead', 'overdue_task', 'overdue_task', 'due_task', 'stale']);
    expect(q.counts).toMatchObject({ outcome_pending: 1, new_lead: 3, overdue_task: 2, due_task: 1, stale: 1 });
    expect(q.items[1].reason).toMatch(/New lead 40 min ago · Meta · Pune · SLA breached/);
    expect(q.items[2].reason).toMatch(/New lead 2 min ago/);
    expect(q.items[4].reason).toMatch(/^Overdue 5 h: Old overdue about brochure/);
    expect(q.items[6].reason).toMatch(/^Due in 20 min: Upcoming call/);
    expect(q.items[7].reason).toMatch(/No contact for 10 d/);
    expect(q.caughtUp).toBe(false);
    expect(JSON.stringify(q)).not.toMatch(/9500000/); // no phone numbers in the queue
    void stale; void fresh; void hot; void breached;
  });
  it("only shows the caller's own work; other tenants and teammates see an empty, 'caught up' queue", async () => {
    const V = await mkUser(T, 'agent');
    const q = await as(T, V, () => svc().queue(V));
    expect(q).toMatchObject({ items: [], total: 0, caughtUp: true });
    const other = await mkUser(T2, 'agent');
    expect((await as(T2, other, () => svc().queue(other))).total).toBe(0);
  });
});

describe('missed tasks and escalation', () => {
  it('marks missed after grace, notifies agent + managers, escalates after N hours, idempotent, tenant-scoped', async () => {
    const U = await mkUser(T, 'agent');
    clock = new Date('2026-03-11T10:00:00Z');
    const id = await mkLead(T, U, 'Missed Lead', '9600000001', U, { firstContactedAt: mins(-1000) });
    const keep = clock; clock = mins(-120);
    const task: any = await as(T, U, () => svc().createTask({ leadId: id, next: { dueAt: new Date(keep.getTime() + 10 * 60_000), contextNote: 'Call about pending documents' } }));
    clock = keep;
    notes.length = 0;
    expect(await runWithTenant(T, () => svc().processOverdue(String(task._id)))).toBe('skip'); // not due yet
    clock = mins(20); // due + 15 min grace not yet passed
    expect(await runWithTenant(T, () => svc().processOverdue(String(task._id)))).toBe('skip');
    clock = mins(30);
    const r1 = await sys.overdueTasks(clock);
    expect(r1.some((x: any) => String(x._id) === String(task._id))).toBe(true);
    expect((await svc().sweepAll(sys)).missed).toBeGreaterThanOrEqual(1); // also sweeps any earlier overdue tasks in other tests
    expect(await svc().sweepAll(sys)).toMatchObject({ missed: 0 }); // idempotent
    expect(((await runWithTenant(T, () => db.repos.tasks.findById(task._id))) as any).status).toBe('missed');
    const mine = notes.filter((n) => n.payload.taskId === String(task._id));
    expect(mine.map((n) => `${n.kind}:${n.audience}`).sort()).toEqual(['task.missed:managers', 'task.missed:user']);
    expect(String(mine.find((n) => n.audience === 'user').userId)).toBe(U);
    expect((await runWithTenant(T, () => lead.timeline(id))).items.some((a: any) => a.type === 'task_missed')).toBe(true);
    // queue still surfaces it as overdue
    expect((await as(T, U, () => svc().queue(U))).items.find((i) => i.taskId === String(task._id))?.kind).toBe('overdue_task');
    // not escalated before 4h
    expect((await svc().sweepAll(sys)).escalated).toBe(0);
    clock = new Date(keep.getTime() + 5 * 3600_000);
    notes.length = 0;
    expect((await svc().sweepAll(sys)).escalated).toBeGreaterThanOrEqual(1);
    expect(notes.filter((n) => n.kind === 'task.escalated' && n.payload.taskId === String(task._id))).toHaveLength(1);
    expect(((await runWithTenant(T, () => db.repos.tasks.findById(task._id))) as any).escalatedAt).toBeTruthy();
    expect((await svc().sweepAll(sys)).escalated).toBe(0);
    // completing a missed task late is recorded as late
    await as(T, U, () => svc().completeTask(String(task._id)));
    expect((await runWithTenant(T, () => lead.timeline(id))).items.find((a: any) => a.type === 'task_done').payload.late).toBe(true);
  });
  it('rescheduling a missed task reopens it with a valid future time; auto-reassign escalation setting returns the lead to the manager pool', async () => {
    const U = await mkUser(T2, 'agent'); await mkUser(T2, 'manager');
    await db.models.Tenant.updateOne({ _id: T2 }, { $set: { 'settings.do': { autoReassignOnEscalation: true, escalateAfterHours: 1, graceMinutes: 5 } } });
    clock = new Date('2026-03-12T10:00:00Z');
    const id = await mkLead(T2, U, 'Auto Reassign', '9600000002', U, { firstContactedAt: mins(-1000) });
    const keep = clock; clock = mins(-60);
    const task: any = await as(T2, U, () => svc().createTask({ leadId: id, next: { dueAt: new Date(keep.getTime() + 5 * 60_000), contextNote: 'Call about the agreement copy' } }));
    expect(task.graceMinutes).toBe(5);
    clock = new Date(keep.getTime() + 15 * 60_000); await svc().sweepAll(sys);
    clock = new Date(keep.getTime() + 105 * 60_000); await svc().sweepAll(sys);
    clock = keep;
    expect(((await as(T2, U, () => lead.get(id))) as any).ownerId ?? null).toBeNull();
    await expect(as(T2, U, () => svc().rescheduleTask(String(task._id), { dueAt: mins(-5) }))).rejects.toMatchObject({ code: 'invalid_next_action' });
    const re = await as(T2, U, () => svc().rescheduleTask(String(task._id), { dueAt: mins(24 * 60), contextNote: 'Call about the agreement copy tomorrow' }));
    expect(re.status).toBe('open');
  });
  it('cross-tenant sweeps never touch another tenant\'s tasks inside a tenant context', async () => {
    const U = await mkUser(T, 'agent');
    const id = await mkLead(T, U, 'Iso Task', '9600000003', U);
    const keep = clock; clock = mins(-120);
    const t: any = await as(T, U, () => svc().createTask({ leadId: id, next: { dueAt: new Date(keep.getTime() - 60 * 60_000), contextNote: 'Call about isolation test' } }));
    clock = keep;
    expect(await runWithTenant(T2, () => svc().processOverdue(String(t._id)))).toBe('skip');
    expect(((await runWithTenant(T, () => db.repos.tasks.findById(t._id))) as any).status).toBe('open');
  });
});

describe('manual tasks', () => {
  it('requires an active assignee and a concrete next action; agent tasks default to self', async () => {
    const id = await mkLead(T, AG, 'Manual Task', '9700000001', AG);
    clock = new Date('2026-03-13T10:00:00Z');
    await expect(as(T, AG, () => svc().createTask({ leadId: id, next: { dueAt: mins(30), contextNote: 'vague' } }))).rejects.toMatchObject({ code: 'invalid_next_action' });
    await expect(as(T, AG, () => svc().createTask({ leadId: id, assigneeId: String(db.models.User.base.Types.ObjectId.createFromTime(5)), next: { dueAt: mins(30), contextNote: 'Call about the loan documents' } }))).rejects.toMatchObject({ code: 'invalid_assignee' });
    const t = await as(T, AG, () => svc().createTask({ leadId: id, next: { dueAt: mins(30), contextNote: 'Call about the loan documents' } }));
    expect(String(t.assigneeId)).toBe(AG);
    expect((await as(T, AG, () => svc().listTasks({ assigneeId: AG, status: 'open' }))).length).toBeGreaterThan(0);
    await as(T, AG, () => svc().cancelTask(String(t._id)));
    expect(((await as(T, AG, () => lead.get(id))) as any).nextActionAt ?? null).toBeNull();
    void MG;
  });
});
