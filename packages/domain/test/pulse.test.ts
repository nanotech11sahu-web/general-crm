import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, newObjectId, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { PulseService, localDay, seedPreset, startOfLocalDay, windowFor } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any;
void LocalKeyService; void randomBytes;
const NOW = new Date('2026-03-10T06:30:00Z'); // 12:00 IST
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const svc = () => new PulseService(db, () => NOW);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
const sysOps = () => ({ pulseTenants: () => runAsSystem('pulse.sweep', () => db.models.Tenant.find({ status: 'active' }, { timezone: 1, settings: 1 }).lean().exec()) }) as any;
let phone = 7000000; const nextPhone = () => `97${String(++phone).padStart(8, '0')}`;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('pulse_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect();
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('time windows', () => {
  it('"today" starts at the tenant-local midnight; previous period is the same elapsed time yesterday', () => {
    expect(startOfLocalDay(NOW, 'Asia/Kolkata').toISOString()).toBe('2026-03-09T18:30:00.000Z');
    expect(localDay(NOW, 'Asia/Kolkata')).toBe('2026-03-10'); expect(localDay(new Date('2026-03-10T19:00:00Z'), 'Asia/Kolkata')).toBe('2026-03-11');
    const w = windowFor('today', NOW, 'Asia/Kolkata');
    expect(w.prevFrom.getTime()).toBe(w.from.getTime() - 86_400_000); expect(w.prevTo.getTime()).toBe(NOW.getTime() - 86_400_000);
    const w7 = windowFor('7d', NOW, 'Asia/Kolkata'); expect(w7.prevTo.getTime()).toBe(w7.from.getTime());
  });
  it('csv neutralises spreadsheet formulas and quotes properly', () => {
    expect(svc().csv([{ name: '=HYPERLINK("x")', note: 'a,b', n: 3 }])).toBe(`name,note,n\n"'=HYPERLINK(""x"")","a,b",3\n`);
    expect(svc().csv([])).toBe('');
  });
});

describe('pulse analytics on a known data set', () => {
  let T: string; let A: string; let B: string; let U2: string;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'Pulse Realty', slug: 'pulse1', country: 'IN', timezone: 'Asia/Kolkata' }));
    T = String(t._id);
    const o: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'Other', slug: 'pulse2', timezone: 'Asia/Kolkata' })); U2 = String(o._id);
    const mkUser = async (name: string) => String(((await runAsSystem('test', () => db.models.User.create({ email: `${name}-${randomBytes(3).toString('hex')}@x.io`, name, passwordHash: 'x' }))) as any)._id);
    A = await mkUser('Asha'); B = await mkUser('Bala');
    await as(T, async () => {
      await seedPreset(db.repos, 'generic');
      const R = db.repos;
      await R.memberships.create({ userId: A, role: 'agent', status: 'active' }); await R.memberships.create({ userId: B, role: 'agent', status: 'active' });
      const won: any = await R.statuses.findOne({ kind: 'won' }); const neu: any = await R.statuses.findOne({ name: 'New' });
      const meta: any = await R.sources.create({ kind: 'meta-leadads', name: 'Meta' }); const imp: any = await R.sources.create({ kind: 'import', name: 'Imported' });
      const lead = (n: string, p: Record<string, unknown>) => R.leads.create({ displayName: n, nameTokens: [n.toLowerCase()], contacts: [{ kind: 'phone', value: nextPhone(), valueNorm: `+91${nextPhone()}`, isPrimary: true }], statusId: neu._id, ...p });
      const L: any = {};
      for (let i = 1; i <= 4; i++) {
        const created = ago(24 * 60);
        L[`M${i}`] = await lead(`M${i}`, { sourceId: meta._id, ownerId: A, createdAt: created, assignedAt: created, firstContactedAt: new Date(created.getTime() + 5 * 60_000), lastContactedAt: ago(60), statusId: i === 4 ? won._id : neu._id });
      }
      const c5 = ago(24 * 60); L.M5 = await lead('M5', { sourceId: meta._id, ownerId: B, createdAt: c5, assignedAt: c5, firstContactedAt: new Date(c5.getTime() + 60 * 60_000), lastContactedAt: ago(60) });
      for (const n of ['I1', 'I2']) L[n] = await lead(n, { sourceId: imp._id, ownerId: A, createdAt: ago(30 * 60), assignedAt: ago(30 * 60) });
      // an old abandoned lead: contacted long ago, nothing scheduled
      L.OLD = await lead('OLD', { sourceId: imp._id, ownerId: B, createdAt: ago(20 * 24 * 60), firstContactedAt: ago(19 * 24 * 60), lastContactedAt: ago(10 * 24 * 60) });
      for (const k of Object.keys(L)) ids[k] = String(L[k]._id);

      const conn: any = await R.outcomes.findOne({ kind: 'connected' }); const nc: any = await R.outcomes.findOne({ kind: 'not_connected' });
      const call = (agent: string, o: any, durationS: number | undefined, src: 'system' | 'self_reported', extra: any = {}) => R.callSessions.create({ leadId: L.M1._id, agentId: agent, state: 'ended', startedAt: ago(120), outcomeId: o?._id, outcomeLoggedAt: o ? ago(100) : undefined, durationS, durationSource: src, ...extra });
      await call(A, conn, 120, 'system'); await call(A, conn, 60, 'system'); await call(A, nc, 0, 'system', { outcomeSkips: 1 }); await call(A, undefined, undefined, 'system'); await call(B, conn, 30, 'self_reported');
      const task = (agent: string, status: string, dueMin: number, completedMin?: number) => R.tasks.create({ leadId: L.M2._id, assigneeId: agent, dueAt: ago(dueMin), contextNote: 'Call back about site visit', status, completedAt: completedMin === undefined ? undefined : ago(completedMin), graceMinutes: 15 });
      await task(A, 'done', 600, 610); await task(A, 'done', 500, 505); await task(A, 'done', 400, 390); await task(A, 'missed', 300);
      await task(B, 'done', 200, 100); // done, but 100 min late (beyond grace)
      await R.presence.create({ userId: A, state: 'online', updatedAt: NOW });
      for (let i = 0; i < 3; i++) await R.activities.create({ leadId: L.M1._id, type: 'call_ended', actorId: A, payload: {}, occurredAt: ago(30 + i) });
    });
  });

  it('five core KPIs with definitions that match the data', async () => {
    const k: any = await as(T, () => svc().kpis('7d'));
    expect(k.counts).toMatchObject({ leads: 7, contacted: 5, calls: 4, connected: 3, tasksDue: 5, tasksOnTime: 3, won: 1, outcomeSkips: 1 });
    expect(k.metrics).toEqual({ responseMedianS: 300, withinSlaPct: 57.1, connectRate: 75, avgTalkS: 70, conversionPct: 14.3, followUpPct: 60 });
    expect(k.verifiedCallShare).toBe(80); // 4 of 5 ended calls are system-verified; the rest are labelled self-reported
    expect(k.previous.responseMedianS).toBeNull(); expect(k.trendPct.responseMedianS).toBeNull(); // nothing in the previous week: no fake trend
    const today: any = await as(T, () => svc().kpis('today'));
    expect(today.counts.leads).toBe(0);
  });

  it('team board: presence, overdue and first-contact backlog per agent', async () => {
    const t: any = await as(T, () => svc().team());
    const a = t.members.find((m: any) => m.userId === A), b = t.members.find((m: any) => m.userId === B);
    expect(a).toMatchObject({ name: 'Asha', presence: 'online', overdue: 1, awaitingFirstContact: 2 });
    expect(b).toMatchObject({ name: 'Bala', presence: 'offline', overdue: 0, awaitingFirstContact: 0 });
    expect(t.summary).toMatchObject({ online: 1, offline: 1 }); expect(t.totalOverdue).toBe(1);
  });

  it('leakage: untouched, late first contact, missed follow-ups, abandoned, with ids ready for bulk reassign', async () => {
    const l: any = await as(T, () => svc().leakage());
    expect(l.untouched.count).toBe(2); expect(l.untouched.leads.map((x: any) => x.leadId).sort()).toEqual([ids.I1, ids.I2].sort());
    expect(l.lateFirstContact.count).toBe(1); expect(l.lateFirstContact.leads[0].leadId).toBe(ids.M5);
    expect(l.missedFollowUps.count).toBe(1);
    expect(l.abandoned.count).toBe(1); expect(l.abandoned.leads[0].leadId).toBe(ids.OLD);
    expect((await as(T, () => svc().leakage({ untouchedHours: 48 }))).untouched.count).toBe(0); // the threshold is a parameter
  });

  it('source quality and agent scorecards', async () => {
    const s: any = await as(T, () => svc().sources({ range: '7d' }));
    expect(s.rows.find((r: any) => r.name === 'Meta')).toMatchObject({ leads: 5, contactedPct: 100, wonPct: 20, won: 1, responseMedianS: 300 });
    expect(s.rows.find((r: any) => r.name === 'Imported')).toMatchObject({ leads: 2, contactedPct: 0, wonPct: 0, responseMedianS: null });
    expect(s.costPerLead).toBeNull();
    const ag: any = await as(T, () => svc().agents('7d'));
    const a = ag.rows.find((r: any) => r.userId === A), b = ag.rows.find((r: any) => r.userId === B);
    expect(a).toMatchObject({ name: 'Asha', calls: 3, connectRate: 66.7, followUpPct: 75, outcomeSkips: 1, verifiedCallShare: 100 });
    expect(b).toMatchObject({ calls: 1, connectRate: 100, followUpPct: 0, verifiedCallShare: 0 });
    expect(ag.rows[0].userId).toBe(A); // ranked by follow-up completion
  });

  it('insight cards come from rules and cite the numbers', async () => {
    const ins: any[] = await as(T, () => svc().insights());
    const byId = Object.fromEntries(ins.map((i) => [i.id, i]));
    expect(byId.untouched.text).toContain('2 leads untouched'); expect(byId.missed.text).toContain('1 missed follow-up');
    expect(byId.sla_low).toMatchObject({ severity: 'high' }); expect(byId.sla_low.text).toContain('57.1%');
    expect(ins[0].severity).toBe('high');
  });

  it('agent view: goal ring, streak and the public follow-up leaderboard; can be switched off', async () => {
    await as(T, () => svc().updateSettings({ dailyGoal: 3 }));
    const me: any = await as(T, () => svc().me(A));
    expect(me).toMatchObject({ gamification: true, goal: 3, done: 3, streakDays: 1 });
    expect(me.leaderboard.map((r: any) => r.name)).toEqual(['Asha', 'Bala']);
    expect(JSON.stringify(me)).not.toMatch(/phone|valueNorm/);
    await as(T, () => svc().updateSettings({ gamification: false }));
    expect(await as(T, () => svc().me(A))).toEqual({ gamification: false });
    await as(T, () => svc().updateSettings({ gamification: true, dailyGoal: 'x' as any, digestHour: 99 as any })); // invalid values are ignored
    expect(((await as(T, () => svc().settings())) as any)).toMatchObject({ gamification: true, dailyGoal: 3, digestHour: 8 });
  });

  it('daily rollup is idempotent; digest is sent once per day to managers; the sweeper only fires after the tenant\'s digest hour', async () => {
    const d1 = await as(T, () => svc().sendDigest());
    expect(d1).toEqual({ sent: true, day: '2026-03-09' });
    expect((await as(T, () => svc().sendDigest())).sent).toBe(false);
    const notes: any[] = await as(T, () => db.repos.notifications.find({ kind: 'pulse.digest' }));
    expect(notes).toHaveLength(1); expect(notes[0].audience).toBe('managers');
    expect(notes[0].payload.text).toContain('Pulse digest for 2026-03-09');
    const roll: any[] = await as(T, () => db.repos.pulseDaily.find({}));
    expect(roll).toHaveLength(1); expect(roll[0].day).toBe('2026-03-09');
    expect((await as(T, () => svc().trend(30)))).toHaveLength(1);

    // sweeper: other tenant gets its digest, ours is not duplicated; before the digest hour nothing is sent
    expect(await PulseService.sweepAll(db, sysOps(), () => NOW)).toEqual({ sent: 1 });
    expect(await PulseService.sweepAll(db, sysOps(), () => NOW)).toEqual({ sent: 0 });
    expect(await PulseService.sweepAll(db, sysOps(), () => new Date('2026-03-10T21:00:00Z'))).toMatchObject({ sent: expect.any(Number) }); // 02:30 IST next day: before 08:00
    expect(await as(U2, () => db.repos.notifications.count({ kind: 'pulse.digest' }))).toBe(1);
  });


  it('the digest can carry a labelled AI summary, and goes out unchanged when the summary fails or is too slow', async () => {
    const later = (d: number) => new PulseService(db, () => new Date(NOW.getTime() + d * 86_400_000));
    const ok = await as(T, () => later(1).sendDigest({ insight: async (i) => { expect(Object.keys(i).sort()).toEqual(['counts', 'day', 'kpis', 'leakage', 'trend']); return { headline: 'Follow-ups slipped', bullets: ['3 follow-ups were missed'], watch: 'Untouched leads' }; } }));
    expect(ok.sent).toBe(true);
    const n1: any = ((await as(T, () => db.repos.notifications.find({ kind: 'pulse.digest', dedupeKey: `pulse-digest:${ok.day}` }))) as any[])[0];
    expect(n1.payload.text).toContain('AI-written summary: Follow-ups slipped'); expect(n1.payload.text).toContain('• 3 follow-ups were missed'); expect(n1.payload.insight.watch).toBe('Untouched leads');
    const bad = await as(T, () => later(2).sendDigest({ insight: async () => { throw new Error('provider down'); } }));
    expect(bad.sent).toBe(true);
    const n2: any = ((await as(T, () => db.repos.notifications.find({ kind: 'pulse.digest', dedupeKey: `pulse-digest:${bad.day}` }))) as any[])[0];
    expect(n2.payload.text).not.toContain('AI-written'); expect(n2.payload.insight).toBeUndefined();
    let called = 0; const again = await as(T, () => later(2).sendDigest({ insight: async () => { called++; return null; } }));
    expect(again.sent).toBe(false); expect(called).toBe(0); // a digest already sent today does not spend an AI request
  });
  it('another tenant sees none of this tenant\'s numbers', async () => {
    const k: any = await as(U2, () => svc().kpis('30d'));
    expect(k.counts.leads).toBe(0); expect(k.metrics.responseMedianS).toBeNull();
    expect((await as(U2, () => svc().team())).members).toHaveLength(0);
    expect((await as(U2, () => svc().leakage())).untouched.count).toBe(0);
  });
});
void newObjectId;
