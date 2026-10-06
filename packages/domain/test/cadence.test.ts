import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, MessageRejectedError, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { CadenceService, ConnectionService, DoService, LeadService, MessagingService, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let keys: LocalKeyService; let leads: LeadService;
const sent: any[] = [];
const beh = { reject: null as null | 'window_closed', transport: false, calls: 0 };
const fakeProvider = (id: string, category: 'whatsapp' | 'sms'): Connector => ({
  manifest: { id, category, displayName: id, logo: '', docsUrl: '', auth: { type: 'api_key' }, capabilities: ['msg.send', 'msg.inbound', 'msg.status', 'msg.templates'],
    credentialFields: [{ key: 'token', label: 'Token', type: 'secret', required: true }], configFields: [] },
  async verify() { return { ok: true }; }, async health() { return { ok: true }; },
  async send(_ctx, msg) {
    beh.calls++;
    if (beh.transport) throw new Error('network down');
    if (beh.reject) throw new MessageRejectedError(beh.reject, 'refused by provider');
    sent.push(msg); return { providerMessageId: `pm-${sent.length}-${Math.random().toString(36).slice(2, 7)}` };
  },
  async submitTemplate(_c, t) { return { providerTemplateId: `prov-${t.name}`, status: 'pending' }; },
  async syncTemplates() { return [{ providerTemplateId: 'prov-welcome', name: 'welcome', language: 'en', status: 'approved' as const, body: 'Hi {{1}}' }, { providerTemplateId: 'prov-remote', name: 'remote_only', language: 'en', status: 'approved' as const, body: 'Offer {{1}} for {{2}}' }]; },
});
const registry = new ConnectorRegistry().register(fakeProvider('fake-wa', 'whatsapp')).register(fakeProvider('fake-sms', 'sms'));
const clock = { t: new Date('2026-03-10T06:30:00Z') }; // 12:00 IST (outside quiet hours)
const svc = () => new MessagingService(db, keys, registry, () => clock.t);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
let phone = 9000000;
const nextPhone = () => `98${String(++phone).padStart(8, '0')}`;

async function mkTenant(slug: string, withChannels: ('whatsapp' | 'sms')[] = ['whatsapp', 'sms']) {
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: `${slug} Realty`, slug, country: 'IN', timezone: 'Asia/Kolkata' }));
  const id = String(t._id);
  await runWithTenant(id, async () => {
    await seedPreset(db.repos, 'generic');
    const conns = new ConnectionService(db, keys, registry);
    if (withChannels.includes('whatsapp')) await conns.create({ provider: 'fake-wa', name: 'WA', credentials: { token: 'wa-token-1234' } });
    if (withChannels.includes('sms')) await conns.create({ provider: 'fake-sms', name: 'SMS', credentials: { token: 'sms-token-1234' } });
  });
  return id;
}
const newLead = async (t: string, name = 'Asha Rao', p = nextPhone()) => ({ id: ((await as(t, () => leads.intake({ name, contacts: [{ value: p }], city: 'Pune' }))) as any).leadId as string, phone: `+91${p}` });
const approvedTpl = (t: string, ch: 'whatsapp' | 'sms', name: string, body: string, variables: string[], extra: any = {}) => as(t, async () => {
  const s = svc(); const tpl: any = await s.createTemplate({ channel: ch, name, body, variables, ...extra });
  if (ch === 'sms') { await s.updateTemplate(tpl._id, { dltTemplateId: '1107111', providerTemplateId: 'flow-1', dltHeader: 'ACMEIN', ...extra }); return s.approveSmsTemplate(String(tpl._id)); }
  await runWithTenant(t, () => db.repos.templates.updateOne({ _id: tpl._id }, { $set: { status: 'approved' } }));
  return db.repos.templates.findById(tpl._id);
}) as Promise<any>;
const inbound = (conn: any, from: string, body: string, id = `in-${Math.random()}`, ts = clock.t) => svc().handleInbound(conn, { kind: 'InboundMessage', from, providerMessageId: id, body, timestamp: ts, profileName: 'Inbound Person' });
const conn = (t: string, category: string) => runWithTenant(t, () => db.repos.connections.findOne({ category })) as Promise<any>;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('cad_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); keys = new LocalKeyService(randomBytes(32)); leads = new LeadService(db);
});
afterAll(async () => { await router.close(); await rs.stop(); });


const cad = () => new CadenceService(db, keys, registry, () => clock.t);
const aUser = '65f000000000000000000001';
const ownerOf = async (t: string, leadId: string, userId = aUser) => as(t, async () => {
  await db.repos.memberships.create({ userId, role: 'agent', status: 'active' }).catch(() => undefined);
  await db.repos.leads.updateOne({ _id: leadId }, { $set: { ownerId: userId } });
});
const enrollments = (t: string, leadId: string) => as(t, () => db.repos.enrollments.find({ leadId })) as Promise<any[]>;
const outMsgs = (t: string, leadId: string) => as(t, () => db.repos.messages.find({ leadId, direction: 'out' })) as Promise<any[]>;
/** LeadService enrols with the real clock; tests run on a fake one, so rebase first-touch enrollments onto it. */
const rebase = (t: string, leadId: string, delayMin = 0) => as(t, async () => {
  const at = clock.t, run = new Date(at.getTime() + delayMin * 60_000);
  await db.repos.enrollments.updateOne({ leadId, kind: 'first_touch' }, { $set: { createdAt: at, nextRunAt: run, 'steps.0.runAt': run } });
});
const newFtLead = async (t: string, name?: string, delayMin = 0) => { const l = await newLead(t, name); await rebase(t, l.id, delayMin); return l; };
const resetClock = () => { clock.t = new Date('2026-03-10T06:30:00Z'); beh.transport = false; beh.reject = null; };

describe('first-touch automation', () => {
  it('needs an approved template; a new lead is enrolled once and gets exactly one opener', async () => {
    resetClock();
    const T = await mkTenant('ft1');
    const tpl = await approvedTpl(T, 'whatsapp', 'welcome_ft', 'Hi {{1}}, thanks for your enquiry!', ['first_name']);
    const draft: any = await as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'draft_ft', body: 'x', variables: [] }));
    await expect(as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(draft._id), delayMinutes: 0 }))).rejects.toMatchObject({ code: 'invalid_first_touch' });
    expect((await as(T, () => cad().enrollFirstTouch({ _id: '65f0000000000000000000aa', contacts: [] }))) ).toBeNull(); // off by default
    await as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(tpl._id), delayMinutes: 0 }));

    const { id } = await newFtLead(T);
    const e = await enrollments(T, id); expect(e).toHaveLength(1); expect(e[0]).toMatchObject({ kind: 'first_touch', state: 'active' });
    const before = sent.length;
    expect(await as(T, () => cad().runDue(String(e[0]._id)))).toBe('sent');
    expect(await as(T, () => cad().runDue(String(e[0]._id)))).toBe('idle'); // completed: nothing more to do
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ channel: 'whatsapp', template: { name: 'welcome_ft', variables: ['Asha'] } });
    const [m] = await outMsgs(T, id); expect(m).toMatchObject({ source: 'first_touch', status: 'sent' });
    expect((await enrollments(T, id))[0]).toMatchObject({ state: 'completed' });

    // a re-enquiry from the same phone merges into the lead and does NOT trigger another opener
    const p = (await as(T, () => db.repos.leads.findById(id)) as any).contacts[0].valueNorm.replace('+91', '');
    await as(T, () => leads.intake({ name: 'Asha Rao', contacts: [{ value: p }] }));
    expect(await enrollments(T, id)).toHaveLength(1);
    // leads that start the conversation themselves or are typed in by hand get no automated opener
    const manual: any = await as(T, () => leads.intake({ name: 'Manual Mina', contacts: [{ value: nextPhone() }], source: { kind: 'manual', name: 'Manual entry' } }));
    expect(await enrollments(T, manual.leadId)).toHaveLength(0);
  });

  it('steps aside when a human already contacted the lead, or the lead replied', async () => {
    resetClock();
    const T = await mkTenant('ft2');
    const tpl = await approvedTpl(T, 'whatsapp', 'welcome_ft', 'Hi {{1}}!', ['first_name']);
    await as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(tpl._id), delayMinutes: 5 }));
    const a = await newFtLead(T, 'Contacted Cy', 5); const b = await newFtLead(T, 'Replying Ria', 5);
    await as(T, () => db.repos.leads.updateOne({ _id: a.id }, { $set: { firstContactedAt: clock.t } }));
    clock.t = new Date(clock.t.getTime() + 6 * 60_000);
    const ea = (await enrollments(T, a.id))[0];
    expect(await as(T, () => cad().runDue(String(ea._id)))).toBe('stopped');
    expect((await enrollments(T, a.id))[0]).toMatchObject({ state: 'stopped', stoppedReason: 'contacted' });
    // reply: the enrollment is stopped immediately (eager), without waiting for the sweeper
    const wa = await conn(T, 'whatsapp');
    await as(T, () => inbound(wa, b.phone.replace('+', ''), 'Hello, yes I am interested'));
    expect((await enrollments(T, b.id))[0]).toMatchObject({ state: 'stopped', stoppedReason: 'reply' });
    expect(await outMsgs(T, a.id)).toHaveLength(0); expect(await outMsgs(T, b.id)).toHaveLength(0);
  });

  it('quiet hours defer the opener to the morning instead of dropping it; the frequency cap defers by an hour', async () => {
    resetClock();
    const T = await mkTenant('ft3');
    const tpl = await approvedTpl(T, 'whatsapp', 'welcome_ft', 'Hi {{1}}!', ['first_name']);
    await as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(tpl._id), delayMinutes: 0 }));
    clock.t = new Date('2026-03-10T16:30:00Z'); // 22:00 IST: quiet
    const { id } = await newFtLead(T);
    const e = (await enrollments(T, id))[0];
    expect(await as(T, () => cad().runDue(String(e._id)))).toBe('deferred');
    const after: any = (await enrollments(T, id))[0];
    expect(after.state).toBe('active');
    const next = new Date(after.nextRunAt);
    expect(next.toISOString()).toBe('2026-03-11T03:30:00.000Z'); // 09:00 IST
    expect((await outMsgs(T, id))).toHaveLength(0);
    clock.t = next;
    expect(await as(T, () => cad().runDue(String(e._id)))).toBe('sent');

    // frequency cap: three automated messages in 24 h already
    resetClock();
    const L = await newFtLead(T, 'Capped Cap');
    const wa = await conn(T, 'whatsapp');
    await as(T, async () => { const conv: any = await db.repos.conversations.create({ leadId: L.id, channel: 'whatsapp', connectionId: wa._id, externalThreadId: L.phone }); for (let i = 0; i < 3; i++) await db.repos.messages.create({ conversationId: conv._id, leadId: L.id, direction: 'out', channel: 'whatsapp', body: 'x', source: 'cadence', status: 'sent', idempotencyKey: `cap-${L.id}-${i}` }); });
    const le = (await enrollments(T, L.id))[0];
    expect(await as(T, () => cad().runDue(String(le._id)))).toBe('deferred');
    expect(new Date(((await enrollments(T, L.id))[0] as any).nextRunAt).getTime()).toBe(clock.t.getTime() + 3600_000);
  });

  it('transport errors retry the same idempotency key (no double send); a refused message is skipped, not retried', async () => {
    resetClock();
    const T = await mkTenant('ft4');
    const tpl = await approvedTpl(T, 'whatsapp', 'welcome_ft', 'Hi {{1}}!', ['first_name']);
    await as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(tpl._id), delayMinutes: 0 }));
    const { id } = await newFtLead(T);
    const e = (await enrollments(T, id))[0];
    beh.transport = true;
    expect(await as(T, () => cad().runDue(String(e._id)))).toBe('deferred');
    expect((await enrollments(T, id))[0]).toMatchObject({ attempts: 1, state: 'active' });
    clock.t = new Date(clock.t.getTime() + 6 * 60_000); beh.transport = false;
    const before = sent.length;
    expect(await as(T, () => cad().runDue(String(e._id)))).toBe('sent');
    expect(sent.length).toBe(before + 1); expect(await outMsgs(T, id)).toHaveLength(1);

    const L = await newFtLead(T, 'Refused Rex');
    beh.reject = 'window_closed';
    const le = (await enrollments(T, L.id))[0];
    expect(await as(T, () => cad().runDue(String(le._id)))).toBe('skipped');
    expect((await enrollments(T, L.id))[0]).toMatchObject({ state: 'completed' });
    expect(((await enrollments(T, L.id))[0] as any).steps[0].result).toMatch(/^skipped:/);
    beh.reject = null;
  });
});

describe('cadences', () => {
  it('validates definitions, enrols manually, runs steps in order (task then message) and stops on status change', async () => {
    resetClock();
    const T = await mkTenant('cd1');
    const tpl = await approvedTpl(T, 'whatsapp', 'nudge', 'Hi {{1}}, any questions?', ['first_name']);
    await expect(as(T, () => cad().create({ name: 'Bad', steps: [{ offsetMinutes: 60, action: 'message', channel: 'whatsapp', templateId: '65f0000000000000000000ab' }, { offsetMinutes: 10, action: 'task', note: 'x' }] }))).rejects.toMatchObject({ code: 'invalid_cadence', details: expect.objectContaining({ 'steps.0.templateId': expect.any(String), 'steps.1.offsetMinutes': expect.any(String), 'steps.1.note': expect.any(String) }) });
    const c: any = await as(T, () => cad().create({ name: 'Nurture', steps: [{ offsetMinutes: 0, action: 'task', taskType: 'call', note: 'Call the lead and qualify budget' }, { offsetMinutes: 120, action: 'message', channel: 'whatsapp', templateId: String(tpl._id) }, { offsetMinutes: 1440, action: 'message', channel: 'whatsapp', templateId: String(tpl._id) }] }));
    await expect(as(T, () => cad().create({ name: 'Nurture', steps: c.steps }))).rejects.toMatchObject({ code: 'duplicate_name' });

    const A = await newLead(T, 'Nurtured Nia'); const B = await newLead(T, 'Moved Mo');
    await ownerOf(T, A.id); await ownerOf(T, B.id);
    const r = await as(T, () => cad().enroll(A.id, String(c._id)));
    expect(r.created).toBe(true);
    expect((await as(T, () => cad().enroll(A.id, String(c._id)))).created).toBe(false); // already running
    await as(T, () => cad().enroll(B.id, String(c._id)));

    expect(await as(T, () => cad().runDue(r.enrollmentId!))).toBe('task');
    const tasks: any[] = await as(T, () => db.repos.tasks.find({ leadId: A.id }));
    expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ contextNote: 'Call the lead and qualify budget', type: 'call' });
    expect(await as(T, () => cad().runDue(r.enrollmentId!))).toBe('idle'); // step 2 is not due yet

    // a human moves B's status: B's cadence stops now, A's continues
    const st: any = ((await as(T, () => db.repos.statuses.find({ kind: 'open' }))) as any[])[1];
    await as(T, () => leads.changeStatus(B.id, String(st._id)));
    expect((await enrollments(T, B.id))[0]).toMatchObject({ state: 'stopped', stoppedReason: 'status_change' });

    clock.t = new Date(clock.t.getTime() + 121 * 60_000);
    expect(await as(T, () => cad().runDue(r.enrollmentId!))).toBe('sent');
    clock.t = new Date(clock.t.getTime() + 24 * 3600_000);
    // 24h later it is 12:30 IST again: second message goes out, cadence completes
    expect(await as(T, () => cad().runDue(r.enrollmentId!))).toBe('sent');
    expect((await enrollments(T, A.id))[0]).toMatchObject({ state: 'completed', stepIndex: 3 });
    expect((await outMsgs(T, A.id)).map((m: any) => m.source)).toEqual(['cadence', 'cadence']);
    expect(await outMsgs(T, B.id)).toHaveLength(0);
    const tl: any[] = await as(T, () => db.repos.activities.find({ leadId: B.id, type: 'cadence_stopped' }));
    expect(tl[0].payload.reason).toBe('status_change');
  });

  it('auto-enrols on a matching outcome; a connected call stops running cadences; opt-out stops them', async () => {
    resetClock();
    const T = await mkTenant('cd2');
    const tpl = await approvedTpl(T, 'whatsapp', 'nudge', 'Hi {{1}}!', ['first_name']);
    const notReach: any = await as(T, () => db.repos.outcomes.findOne({ label: 'Not Reachable' }));
    const connected: any = await as(T, () => db.repos.outcomes.findOne({ label: 'Connected - Callback' }));
    await as(T, () => cad().create({ name: 'Unreachable follow-up', enrollOn: { outcomeIds: [String(notReach._id)] }, steps: [{ offsetMinutes: 60, action: 'message', channel: 'whatsapp', templateId: String(tpl._id) }] }));
    const L = await newLead(T, 'Unreach Uma'); await ownerOf(T, L.id);
    const doAs = <R>(fn: (d: DoService) => Promise<R>) => as(T, () => fn(new DoService(db, () => clock.t)));
    const inDays = (n: number) => new Date(clock.t.getTime() + n * 86400_000).toISOString();
    await doAs((d) => d.logOutcome({ leadId: L.id, outcomeId: String(notReach._id), next: { dueAt: new Date(clock.t.getTime() + 86400_000), contextNote: 'Try again tomorrow evening' } }));
    expect((await enrollments(T, L.id))[0]).toMatchObject({ state: 'active', kind: 'cadence' });
    await doAs((d) => d.logOutcome({ leadId: L.id, outcomeId: String(connected._id), next: { dueAt: new Date(inDays(2)), contextNote: 'Callback on Friday about budget' } }));
    expect((await enrollments(T, L.id))[0]).toMatchObject({ state: 'stopped', stoppedReason: 'connected_call' });

    // opt-out: STOP stops everything immediately and nothing is sent
    const M = await newLead(T, 'Optout Oli');
    const c: any = ((await as(T, () => db.repos.cadences.find({}))) as any[])[0];
    const en = await as(T, () => cad().enroll(M.id, String(c._id)));
    await as(T, async () => inbound(await conn(T, 'whatsapp'), M.phone.replace('+', ''), 'STOP'));
    expect((await enrollments(T, M.id))[0]).toMatchObject({ state: 'stopped', stoppedReason: 'opt_out' });
    clock.t = new Date(clock.t.getTime() + 2 * 3600_000);
    expect(await as(T, () => cad().runDue(en.enrollmentId!))).toBe('idle');
    expect(await outMsgs(T, M.id)).toHaveLength(0);
  });

  it('the sweeper runs due enrollments for every tenant under its own tenant context, and one tenant never affects another', async () => {
    resetClock();
    const [T1, T2] = [await mkTenant('sw1'), await mkTenant('sw2')];
    for (const T of [T1, T2]) {
      const tpl = await approvedTpl(T, 'whatsapp', 'welcome_ft', 'Hi {{1}}!', ['first_name']);
      await as(T, () => cad().setFirstTouch({ enabled: true, channel: 'whatsapp', templateId: String(tpl._id), delayMinutes: 0 }));
    }
    const a = await newFtLead(T1, 'Sweep One'); const b = await newFtLead(T2, 'Sweep Two');
    const out = await cad().sweepAll({ dueEnrollments: (now: Date, limit: number) => runAsSystem('cadence.sweep', () => db.models.CadenceEnrollment.find({ state: 'active', nextRunAt: { $lte: now } }, { tenantId: 1 }).limit(limit).lean().exec()) } as any);
    expect(out.sent).toBeGreaterThanOrEqual(2);
    expect(await outMsgs(T1, a.id)).toHaveLength(1); expect(await outMsgs(T2, b.id)).toHaveLength(1);
    expect(await as(T1, () => db.repos.enrollments.find({ leadId: b.id }))).toHaveLength(0);
  });
});

describe('inbound replies in the Today queue', () => {
  it('a reply puts the lead in the owner\'s queue (above stale, below tasks) and reading the thread clears it', async () => {
    resetClock();
    const T = await mkTenant('q1');
    const L = await newLead(T, 'Replier Ray'); await ownerOf(T, L.id);
    const wa = await conn(T, 'whatsapp');
    await as(T, () => inbound(wa, L.phone.replace('+', ''), 'Is the 3BHK still available?'));
    const q: any = await as(T, () => new DoService(db, () => clock.t).queue(aUser));
    const item = q.items.find((i: any) => i.kind === 'inbound');
    expect(item).toMatchObject({ leadId: L.id, suggestedAction: { type: 'whatsapp' } });
    expect(item.reason).toContain('Is the 3BHK still available?');
    // someone else's queue does not contain it
    const other: any = await as(T, () => new DoService(db, () => clock.t).queue('65f000000000000000000002'));
    expect(other.items.find((i: any) => i.kind === 'inbound')).toBeUndefined();
    const conv: any = (await as(T, () => svc().conversations(L.id)))[0];
    await as(T, () => svc().markRead(String(conv._id)));
    expect(((await as(T, () => new DoService(db, () => clock.t).queue(aUser))) as any).items.find((i: any) => i.kind === 'inbound')).toBeUndefined();
  });
});
