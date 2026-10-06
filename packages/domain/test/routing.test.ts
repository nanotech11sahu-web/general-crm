import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSystemOps, migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { DoService, inTimeWindow, LeadService, PresenceService, RoutingService, SlaService, seedPreset, validateRule, withinWorkingHours } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let sys: any; let leads: LeadService;
const as = <T>(t: string, user: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: user });
const notes: any[] = []; const notifier = { notify: async (n: any) => { notes.push(n); } };
let phoneSeq = 8000000;
const phone = () => `9${++phoneSeq}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`.slice(0, 10);

async function mkTenant(slug: string, tz = 'Asia/Kolkata') {
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN', timezone: tz }));
  const id = String(t._id);
  await runWithTenant(id, () => seedPreset(db.repos, 'generic'));
  return id;
}
async function mkAgent(t: string, name: string, extra: any = {}, role = 'agent') {
  const u: any = await db.models.User.create({ email: `${name}-${Math.random()}@x.io`, name });
  await runWithTenant(t, () => db.repos.memberships.create({ userId: u._id, role, ...extra }));
  return String(u._id);
}
const online = (t: string, ...ids: string[]) => runWithTenant(t, async () => { for (const i of ids) await new PresenceService(db).set(i, 'online'); });
const newLead = async (t: string, extra: any = {}) => {
  const r: any = await as(t, '65f000000000000000000001', () => leads.intake({ name: extra.name ?? 'L', contacts: [{ value: phone() }], source: { kind: extra.source ?? 'meta', name: 'Meta' }, city: extra.city, language: extra.language, campaign: extra.campaign, custom: extra.custom, score: extra.score }));
  return r.leadId as string;
};
const owner = async (t: string, id: string) => String(((await runWithTenant(t, () => db.repos.leads.findById(id))) as any).ownerId ?? '');
const explain = async (t: string, id: string) => ((await runWithTenant(t, () => db.repos.routingDecisions.find({ leadId: id }))) as any[])[0]?.explanation as string;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('routing_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); sys = createSystemOps(db.models); leads = new LeadService(db);
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('time helpers', () => {
  it('time-of-day windows (incl. wrapping midnight) and working hours use the tenant timezone', () => {
    const sat11 = new Date('2026-03-14T05:30:00Z'); // Sat 11:00 IST
    expect(inTimeWindow(sat11, 'Asia/Kolkata', '09:00', '18:00')).toBe(true);
    expect(inTimeWindow(sat11, 'Asia/Kolkata', '21:00', '09:00')).toBe(false);
    expect(inTimeWindow(new Date('2026-03-14T17:30:00Z'), 'Asia/Kolkata', '21:00', '09:00')).toBe(true); // 23:00 IST
    const wh = { days: { mon: [['09:00', '18:00']], sat: [['10:00', '13:00']] } };
    expect(withinWorkingHours(wh, sat11, 'Asia/Kolkata')).toBe(true);
    expect(withinWorkingHours(wh, new Date('2026-03-14T09:00:00Z'), 'Asia/Kolkata')).toBe(false); // Sat 14:30
    expect(withinWorkingHours(wh, new Date('2026-03-15T05:30:00Z'), 'Asia/Kolkata')).toBe(false); // Sunday
    expect(withinWorkingHours(undefined, sat11, 'Asia/Kolkata')).toBe(true);
  });
  it('rule validation', () => {
    expect(() => validateRule({ name: '', action: { kind: 'round_robin' } })).toThrow();
    expect(() => validateRule({ name: 'x', action: { kind: 'specific_user' } })).toThrow(/Invalid assignment rule/);
    expect(() => validateRule({ name: 'x', action: { kind: 'team_pool' } })).toThrow();
    expect(() => validateRule({ name: 'x', action: { kind: 'round_robin' }, conditions: { timeOfDay: { from: '9am', to: '18:00' } } })).toThrow();
    expect(() => validateRule({ name: 'x', action: { kind: 'round_robin' } })).not.toThrow();
  });
});

describe('routing engine', () => {
  it('is off until configured: leads stay in the manager pool', async () => {
    const T = await mkTenant('off'); await mkAgent(T, 'a');
    const id = await newLead(T);
    expect(await owner(T, id)).toBe('');
    expect(await runWithTenant(T, () => db.repos.routingDecisions.count())).toBe(0);
  });

  it('first matching rule wins, round-robin is even, and every decision is explained', async () => {
    const T = await mkTenant('rr');
    const [a1, a2, a3] = [await mkAgent(T, 'A1'), await mkAgent(T, 'A2'), await mkAgent(T, 'A3')];
    await online(T, a1, a2, a3);
    await runWithTenant(T, () => new RoutingService(db).setRules([
      { name: 'Pune Meta', conditions: { sourceKinds: ['meta'], cities: ['pune'] }, action: { kind: 'round_robin', poolUserIds: [a1, a2] } },
      { name: 'Everything else', action: { kind: 'specific_user', userId: a3 } },
    ]));
    const pune = await Promise.all(Array.from({ length: 4 }, () => newLead(T, { city: 'Pune' })));
    const owners = (await Promise.all(pune.map((id) => owner(T, id)))).sort();
    expect(owners).toEqual([a1, a1, a2, a2].sort());
    expect(await explain(T, pune[0])).toMatch(/Rule "Pune Meta" \(#1\) matched: source=meta, city=Pune -> round-robin over 2 .*online, in working hours/);
    const other = await newLead(T, { city: 'Delhi' });
    expect(await owner(T, other)).toBe(a3);
    expect(await explain(T, other)).toMatch(/Rule "Everything else" \(#2\)/);
    const tl = await runWithTenant(T, () => leads.timeline(other));
    expect(tl.items.find((x: any) => x.type === 'assigned').payload.explanation).toMatch(/specific user/);
    expect(await runWithTenant(T, () => db.repos.outbox.count({ type: 'lead.assigned' }))).toBeGreaterThanOrEqual(5);
  });

  it('presence, working hours, leave, capacity, language and skills are respected; relaxes only with an explanation', async () => {
    const T = await mkTenant('filters');
    const wh = { days: { mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']], sat: [['09:00', '18:00']], sun: [['09:00', '18:00']] } };
    const never = { days: {} };
    const offline = await mkAgent(T, 'Offline');
    const afterHours = await mkAgent(T, 'AfterHours', { workingHours: never });
    const leave = await mkAgent(T, 'Leave', { onLeaveUntil: new Date(Date.now() + 86400_000) });
    const hindi = await mkAgent(T, 'Hindi', { languages: ['Hindi'], skills: ['premium'], workingHours: wh });
    const eng = await mkAgent(T, 'Eng', { languages: ['English'], workingHours: wh });
    const capped = await mkAgent(T, 'Capped', { maxOpenLeads: 1 });
    await online(T, afterHours, leave, hindi, eng, capped);
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'Pool', action: { kind: 'round_robin', poolUserIds: [offline, afterHours, leave, hindi, eng, capped] } }]));
    // capped agent already has one open lead
    await runWithTenant(T, () => db.repos.leads.createWithContacts({ displayName: 'x', ownerId: db.models.User.base.Types.ObjectId.createFromHexString(capped), contacts: [{ kind: 'phone', valueNorm: '+919999900001' }] }));
    const ids = await Promise.all(Array.from({ length: 6 }, () => newLead(T, { language: 'Hindi' })));
    for (const id of ids) expect(await owner(T, id)).toBe(hindi); // only Hindi speaker who is online, in hours, not on leave, under cap
    const eng2 = await newLead(T, { language: 'English' });
    expect(await owner(T, eng2)).toBe(eng);
    // skills requirement
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'Premium', action: { kind: 'round_robin', poolUserIds: [hindi, eng], requireSkills: ['premium'] } }]));
    expect(await owner(T, await newLead(T))).toBe(hindi);
    // nobody online / in hours: relax, and say so
    await runWithTenant(T, () => db.repos.presence.deleteMany({}));
    const relaxed = await newLead(T);
    expect(await owner(T, relaxed)).toBe(hindi);
    expect(await explain(T, relaxed)).toMatch(/nobody online\/in working hours/);
    // nobody eligible at all (skill nobody has): manager pool
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'Ghost skill', action: { kind: 'round_robin', poolUserIds: [hindi, eng], requireSkills: ['nonexistent'] } }]));
    const none = await newLead(T);
    expect(await owner(T, none)).toBe('');
    expect(await explain(T, none)).toMatch(/manager pool/);
  });

  it('least-loaded, sticky previous owner, team pool, score/custom/campaign conditions, default pool', async () => {
    const T = await mkTenant('strategies');
    const a = await mkAgent(T, 'A'); const b = await mkAgent(T, 'B'); const c = await mkAgent(T, 'C');
    await online(T, a, b, c);
    const mkOwned = (o: string, n: number) => Promise.all(Array.from({ length: n }, () => runWithTenant(T, () => db.repos.leads.createWithContacts({ displayName: 'o', ownerId: db.models.User.base.Types.ObjectId.createFromHexString(o), contacts: [{ kind: 'phone', valueNorm: `+9195${phone()}` }] }))));
    await mkOwned(a, 3); await mkOwned(b, 1);
    await runWithTenant(T, () => new RoutingService(db).setRules([
      { name: 'Hot', conditions: { scoreMin: 80 }, action: { kind: 'specific_user', userId: b } },
      { name: 'Campaign', conditions: { campaignContains: 'summer' }, action: { kind: 'least_loaded', poolUserIds: [a, b, c] } },
      { name: 'Villa', conditions: { custom: { bhk: ['4+'] } }, action: { kind: 'specific_user', userId: a } },
    ], { kind: 'round_robin', poolUserIds: [c] }));
    expect(await owner(T, await newLead(T, { score: 95 }))).toBe(b);
    const ll = await newLead(T, { campaign: 'Summer Launch' });
    expect(await owner(T, ll)).toBe(c); // c has 0 open leads
    expect(await explain(T, ll)).toMatch(/least loaded \(0 open\)/);
    expect(await owner(T, await newLead(T, { score: 10 }))).toBe(c); // default pool
    expect(await explain(T, await newLead(T))).toMatch(/No rule matched: default pool/);
    // score condition needs a score
    const noScore = await newLead(T);
    expect(await explain(T, noScore)).not.toMatch(/Hot/);
    // sticky previous owner
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'Sticky', action: { kind: 'sticky_previous_owner', poolUserIds: [a, b, c], fallback: 'least_loaded' } }]));
    const lead: any = { lastOwnerId: db.models.User.base.Types.ObjectId.createFromHexString(a) };
    const d = await runWithTenant(T, () => new RoutingService(db).decide(lead));
    expect(d.userId).toBe(a); expect(d.explanation).toMatch(/previous owner/);
    const d2 = await runWithTenant(T, () => new RoutingService(db).decide({}, { exclude: [] }));
    expect(d2.explanation).toMatch(/least loaded/);
    // team pool
    const team: any = await runWithTenant(T, () => db.repos.teams.create({ name: 'Pune team' }));
    const t1 = await mkAgent(T, 'T1', { teamId: team._id }); await online(T, t1);
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'Team', action: { kind: 'team_pool', teamId: String(team._id) } }]));
    const tl = await newLead(T);
    expect(await owner(T, tl)).toBe(t1);
    expect(String(((await runWithTenant(T, () => db.repos.leads.findById(tl))) as any).teamId)).toBe(String(team._id));
  });

  it('rules cannot reference users from another tenant; tenants never share round-robin state', async () => {
    const T1 = await mkTenant('iso1'); const T2 = await mkTenant('iso2');
    const x = await mkAgent(T1, 'X'); const y = await mkAgent(T2, 'Y'); await online(T1, x); await online(T2, y);
    await expect(runWithTenant(T1, () => new RoutingService(db).setRules([{ name: 'bad', action: { kind: 'specific_user', userId: y } }]))).rejects.toMatchObject({ code: 'invalid_rule' });
    await runWithTenant(T1, () => new RoutingService(db).setRules([{ name: 'r', action: { kind: 'round_robin' } }]));
    await runWithTenant(T2, () => new RoutingService(db).setRules([{ name: 'r', action: { kind: 'round_robin' } }]));
    expect(await owner(T1, await newLead(T1))).toBe(x);
    expect(await owner(T2, await newLead(T2))).toBe(y);
  });
});

describe('SLA claim + first-contact escalation', () => {
  async function setup(slug: string, policy = { claimSeconds: 120, firstContactSeconds: 600, maxReassignments: 2 }) {
    const T = await mkTenant(slug);
    const ag = [await mkAgent(T, 'S1'), await mkAgent(T, 'S2'), await mkAgent(T, 'S3'), await mkAgent(T, 'S4')];
    await online(T, ...ag);
    const mgr = await mkAgent(T, 'Mgr', {}, 'manager');
    await runWithTenant(T, async () => {
      await new RoutingService(db).setRules([{ name: 'all', action: { kind: 'round_robin', poolUserIds: ag } }]);
      await db.repos.slaPolicies.create({ name: 'Default', ...policy });
    });
    return { T, ag, mgr };
  }
  const sla = (clock: Date) => new SlaService(db, () => clock, notifier);
  const later = (s: number) => new Date(Date.now() + s * 1000);

  it('assignment starts timers; owner can claim inside the window, others cannot, late claims fail', async () => {
    const { T, ag } = await setup('sla1');
    const id = await newLead(T);
    const l: any = await runWithTenant(T, () => db.repos.leads.findById(id));
    expect(l.sla).toMatchObject({ state: 'awaiting_claim', reassignCount: 0 });
    expect(new Date(l.sla.claimDueAt).getTime() - new Date(l.assignedAt).getTime()).toBe(120_000);
    const me = String(l.ownerId); const other = ag.find((x) => x !== me)!;
    await expect(runWithTenant(T, () => sla(new Date()).claim(id, other))).rejects.toMatchObject({ status: 403 });
    await expect(runWithTenant(T, () => sla(later(300)).claim(id, me))).rejects.toMatchObject({ code: 'claim_expired' });
    expect(await runWithTenant(T, () => sla(new Date()).claim(id, me))).toEqual({ ok: true, alreadyClaimed: false });
    expect(await runWithTenant(T, () => sla(new Date()).claim(id, me))).toEqual({ ok: true, alreadyClaimed: true });
    expect(((await runWithTenant(T, () => db.repos.leads.findById(id))) as any).sla.state).toBe('claimed');
    // claimed leads are not reassigned by the claim timer
    expect(await runWithTenant(T, () => sla(later(300)).handleBreach(id, 'claim'))).toBe('skip');
  });

  it('unclaimed lead is reassigned to someone else, then to the manager pool after max reassignments, with notifications', async () => {
    const { T, ag } = await setup('sla2');
    const id = await newLead(T);
    const first = await owner(T, id);
    notes.length = 0;
    expect(await sla(later(150)).sweepAll(sys)).toMatchObject({ reassigned: 1 });
    const second = await owner(T, id);
    expect(second).not.toBe(first); expect(ag).toContain(second);
    expect(notes.some((n) => n.kind === 'sla.breached' && String(n.userId) === first)).toBe(true);
    expect(notes.some((n) => n.kind === 'lead.assigned' && String(n.userId) === second)).toBe(true);
    expect(await explain(T, id)).toMatch(/SLA claim timeout/);
    // timers restart for the new owner
    const l2: any = await runWithTenant(T, () => db.repos.leads.findById(id));
    expect(l2.sla).toMatchObject({ state: 'awaiting_claim', reassignCount: 1 });
    expect(l2.sla.triedUserIds).toEqual(expect.arrayContaining([first, second]));
    expect(await sla(later(150 + 150)).sweepAll(sys)).toMatchObject({ reassigned: 1 });
    const third = await owner(T, id);
    expect([first, second]).not.toContain(third);
    notes.length = 0;
    expect(await sla(later(150 + 150 + 150)).sweepAll(sys)).toMatchObject({ escalated: 1 });
    expect(await owner(T, id)).toBe('');
    expect(notes.some((n) => n.kind === 'lead.unclaimed' && n.audience === 'managers')).toBe(true);
    expect(((await runWithTenant(T, () => db.repos.leads.findById(id))) as any).sla.state).toBe('escalated');
    // the manager-pool lead is not swept again
    await sla(later(5000)).sweepAll(sys); // other tests' leads may also be due; ours must stay put
    expect(await owner(T, id)).toBe('');
    const tl = (await runWithTenant(T, () => leads.timeline(id))).items.filter((x: any) => ['assigned', 'reassigned'].includes(x.type));
    expect(tl.length).toBe(4); // initial + 2 reassignments + manager pool
  });

  it('claimed-but-never-contacted lead escalates on the first-contact timer; contacting cancels timers', async () => {
    const { T, ag } = await setup('sla3');
    const a = await newLead(T); const b = await newLead(T);
    for (const id of [a, b]) { const o = await owner(T, id); await runWithTenant(T, () => sla(new Date()).claim(id, o)); }
    // agent contacts lead b via the outcome sheet, which must cancel its SLA timers
    const ob = await owner(T, b);
    const outcome: any = await runWithTenant(T, () => db.repos.outcomes.findOne({ label: 'Wrong Number' }));
    await as(T, ob, () => new DoService(db).logOutcome({ leadId: b, outcomeId: String(outcome._id) }));
    expect(((await runWithTenant(T, () => db.repos.leads.findById(b))) as any).sla.state).toBe('contacted');
    const res = await sla(later(700)).sweepAll(sys);
    expect(res.reassigned).toBe(1); // only lead a
    expect(await owner(T, b)).toBe(ob);
    expect(await owner(T, a)).not.toBe(''); void ag;
  });

  it('two sweepers racing produce exactly one reassignment', async () => {
    const { T } = await setup('sla4');
    const id = await newLead(T);
    const c1 = later(200);
    const [r1, r2] = await Promise.all([sla(c1).sweepAll(sys), sla(c1).sweepAll(sys)]);
    expect(r1.reassigned + r2.reassigned).toBe(1);
    expect(((await runWithTenant(T, () => db.repos.leads.findById(id))) as any).sla.reassignCount).toBe(1);
  });

  it('SLA policy can be scoped by source kind; no policy => no timers', async () => {
    const T = await mkTenant('sla5'); const a = await mkAgent(T, 'Z'); await online(T, a);
    await runWithTenant(T, async () => {
      await new RoutingService(db).setRules([{ name: 'all', action: { kind: 'round_robin' } }]);
      await db.repos.slaPolicies.create({ name: 'Meta only', claimSeconds: 60, firstContactSeconds: 300, appliesTo: { sourceKinds: ['meta'] } });
    });
    const meta = await newLead(T, { source: 'meta' }); const web = await newLead(T, { source: 'website' });
    expect(((await runWithTenant(T, () => db.repos.leads.findById(meta))) as any).sla.state).toBe('awaiting_claim');
    expect(((await runWithTenant(T, () => db.repos.leads.findById(web))) as any).sla).toBeUndefined();
  });
});

describe('presence', () => {
  it('stale heartbeats read as offline; calls flip presence to on_call and back', async () => {
    const T = await mkTenant('pres'); const u = await mkAgent(T, 'P');
    const p = new PresenceService(db);
    await runWithTenant(T, () => p.set(u, 'online'));
    expect((await runWithTenant(T, () => p.get([u])))[u]).toBe('online');
    expect((await runWithTenant(T, () => new PresenceService(db, () => new Date(Date.now() + 10 * 60_000)).get([u])))[u]).toBe('offline');
    await runWithTenant(T, () => new RoutingService(db).setRules([{ name: 'r', action: { kind: 'round_robin' } }]));
    const id = await newLead(T, {}); await runWithTenant(T, () => db.repos.leads.updateOne({ _id: id }, { $set: { ownerId: u } }));
    await as(T, u, () => new DoService(db).startCall(id));
    expect((await runWithTenant(T, () => p.get([u])))[u]).toBe('on_call');
  });
});
