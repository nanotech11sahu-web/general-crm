/**
 * Performance budgets at realistic scale (spec §18): index audit via explain(), API latency p95 with 20k leads in the tenant
 * (+ 20k in neighbours), and "no N+1" command counts. Real MongoDB; data is inserted with the raw driver for speed.
 */
import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, newObjectId, toObjectId } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any; let raw: MongoClient; let dbName: string;
const N = Number(process.env.PERF_LEADS ?? 20_000);
let token: string; let tenantId: string; let agentTok: string; let agentId: string; let tid: any;
const DAY = 86_400_000; const now = Date.now();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const col = (n: string) => raw.db(dbName).collection(n);
async function bulk(name: string, docs: any[]) { for (let i = 0; i < docs.length; i += 5000) await col(name).insertMany(docs.slice(i, i + 5000), { ordered: false, bypassDocumentValidation: true }); }

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('perf'); dbName = 'perf';
  Object.assign(process.env, { JWT_ACCESS_SECRET: 'perf-secret-0123456789', RATE_LIMITS: 'off', LOCAL_KEK_BASE64: randomBytes(32).toString('base64') });
  raw = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(raw.db(dbName));
  const { AppModule } = await import('../src/app.module'); const { configureApp } = await import('../src/setup');
  app = configureApp((await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication()); await app.init(); http = app.getHttpServer();

  const o = await request(http).post('/v1/auth/signup').send({ email: 'perf-owner@x.io', password: 'correct-horse-9', name: 'Perf', tenantName: 'Perf Co', industryPreset: 'real_estate' }).expect(201);
  token = o.body.accessToken; tenantId = o.body.tenantId; tid = toObjectId(tenantId);
  const inv = await request(http).post('/v1/invitations').set(auth(token)).send({ email: 'perf-agent@x.io', role: 'agent' }).expect(201);
  const a = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Perf Agent', password: 'agent-pass-123' }).expect(201);
  agentTok = a.body.accessToken; agentId = (await request(http).get('/v1/me').set(auth(agentTok))).body.userId;

  const statuses: any[] = await col('leadstatuses').find({ tenantId: tid }).sort({ position: 1 }).toArray();
  const sources: any[] = await col('leadsources').find({ tenantId: tid }).toArray();
  const agents = [toObjectId(agentId), ...Array.from({ length: 9 }, () => newObjectId())];
  const cities = ['Pune', 'Mumbai', 'Delhi', 'Nashik', 'Nagpur', 'Thane', 'Surat'];
  const tenants = [tid, newObjectId(), newObjectId()]; // two neighbours of the same size: nothing may scan across tenants
  let p = 9_000_000_00; const leads: any[] = []; const idx: any[] = []; const acts: any[] = []; const tasks: any[] = []; const convs: any[] = []; const msgs: any[] = []; const calls: any[] = [];
  for (const T of tenants) {
    for (let i = 0; i < N; i++) {
      const created = new Date(now - Math.floor(Math.random() * 60 * DAY)); const owner = agents[i % agents.length]; const contacted = i % 3 !== 0;
      const num = `+91${++p}`; const _id = newObjectId();
      leads.push({ _id, tenantId: T, displayName: `Lead ${i} ${cities[i % 7]}`, nameTokens: [`lead`, String(i), cities[i % 7].toLowerCase()], contacts: [{ kind: 'phone', value: num, valueNorm: num, isPrimary: true }], phoneNorms: [num, num.slice(-10), num.slice(-6)], city: cities[i % 7], statusId: statuses[i % statuses.length]?._id, sourceId: sources[i % Math.max(1, sources.length)]?._id, ownerId: T === tid ? owner : newObjectId(), assignedAt: created, createdAt: created, updatedAt: created, firstContactedAt: contacted ? new Date(created.getTime() + 600_000) : null, lastContactedAt: contacted ? new Date(created.getTime() + 2 * DAY) : null, nextActionAt: i % 5 === 0 ? new Date(now + DAY) : null, deletedAt: null, tags: [], custom: {} });
      idx.push({ _id: newObjectId(), tenantId: T, kind: 'phone', valueNorm: num, leadId: _id });
      for (let k = 0; k < 3 && T === tid; k++) acts.push({ tenantId: T, leadId: _id, type: 'note', payload: { note: 'x' }, occurredAt: new Date(created.getTime() + k * 3600_000) });
      if (i % 2 === 0) tasks.push({ tenantId: T, leadId: _id, assigneeId: T === tid ? owner : newObjectId(), type: 'call', dueAt: new Date(now + (i % 7 - 3) * DAY), contextNote: 'Call back about site visit', status: i % 4 === 0 ? 'done' : 'open', graceMinutes: 15, createdAt: created, updatedAt: created });
      if (i % 4 === 0) { const cid = newObjectId(); convs.push({ _id: cid, tenantId: T, leadId: _id, channel: 'whatsapp', connectionId: newObjectId(), unreadCount: i % 8 === 0 ? 1 : 0, lastInboundAt: created, lastMessageAt: created }); for (let k = 0; k < 3; k++) msgs.push({ tenantId: T, conversationId: cid, leadId: _id, direction: k === 0 ? 'in' : 'out', channel: 'whatsapp', body: 'hi', status: 'sent', createdAt: new Date(created.getTime() + k * 60_000), updatedAt: created }); }
      if (i % 3 === 1) calls.push({ tenantId: T, leadId: _id, agentId: T === tid ? owner : newObjectId(), state: 'ended', startedAt: created, outcomeLoggedAt: created, durationS: 60, durationSource: 'system', createdAt: created, updatedAt: created });
    }
  }
  await Promise.all([bulk('leads', leads), bulk('leadcontactindexes', idx), bulk('activities', acts), bulk('tasks', tasks), bulk('conversations', convs), bulk('messages', msgs), bulk('callsessions', calls)]);
  (globalThis as any).__seed = { statuses, agents };
}, 300_000);
afterAll(async () => { await app?.close(); await raw?.close(); await rs?.stop(); });

// ---------- 1. index audit: every hot query must be index-backed, with no scan and no big in-memory sort ----------
type Plan = { stages: string[]; docs: number; keys: number; returned: number };
const walk = (s: any, out: string[] = []): string[] => { if (!s) return out; out.push(s.stage); walk(s.inputStage, out); (s.inputStages ?? []).forEach((x: any) => walk(x, out)); return out; };
async function explain(name: string, filter: any, o: { sort?: any; limit?: number } = {}): Promise<Plan> {
  let c = col(name).find(filter); if (o.sort) c = c.sort(o.sort); if (o.limit) c = c.limit(o.limit);
  const e: any = await c.explain('executionStats');
  return { stages: walk(e.executionStats.executionStages), docs: e.executionStats.totalDocsExamined, keys: e.executionStats.totalKeysExamined, returned: e.executionStats.nReturned };
}
const openIds = () => (globalThis as any).__seed.statuses.filter((s: any) => s.kind === 'open').map((s: any) => s._id);
const T = () => ({ tenantId: tid });
const soon = () => new Date(now + 30 * 60_000); const day = (n: number) => new Date(now - n * DAY);

describe('index audit (explain on seeded data)', () => {
  const me = () => toObjectId(agentId);
  const cases: [string, string, () => any, { sort?: any; limit?: number }?][] = [
    ['leads: default list', 'leads', () => ({ ...T(), deletedAt: null }), { sort: { _id: -1 }, limit: 51 }],
    ['leads: agent scope list', 'leads', () => ({ ...T(), deletedAt: null, ownerId: me() }), { sort: { _id: -1 }, limit: 51 }],
    ['leads: by status', 'leads', () => ({ ...T(), deletedAt: null, statusId: { $in: openIds() } }), { sort: { _id: -1 }, limit: 51 }],
    ['leads: phone search', 'leads', () => ({ ...T(), phoneNorms: { $in: ['9000000100'] } })],
    ['leads: name prefix search', 'leads', () => ({ ...T(), deletedAt: null, nameTokens: { $regex: '^lead' } }), { sort: { _id: -1 }, limit: 51 }],
    ['queue: fresh leads', 'leads', () => ({ ...T(), ownerId: me(), deletedAt: null, firstContactedAt: null, $or: [{ statusId: { $in: openIds() } }, { statusId: null }] }), { sort: { _id: 1 }, limit: 200 }],
    ['queue: stale leads', 'leads', () => ({ ...T(), ownerId: me(), deletedAt: null, nextActionAt: null, firstContactedAt: { $ne: null }, lastContactedAt: { $lt: day(14) }, $or: [{ statusId: { $in: openIds() } }, { statusId: null }] }), { sort: { lastContactedAt: 1 }, limit: 100 }],
    ['queue: my leads (ids)', 'leads', () => ({ ...T(), ownerId: me(), deletedAt: null }), { limit: 5000 }],
    ['queue: tasks due', 'tasks', () => ({ ...T(), assigneeId: me(), status: { $in: ['open', 'missed'] }, dueAt: { $lte: soon() } }), { sort: { dueAt: 1 }, limit: 200 }],
    ['queue: pending outcome', 'callsessions', () => ({ ...T(), agentId: me(), outcomeLoggedAt: null, state: { $in: ['dialed', 'ended', 'answered'] } }), { sort: { startedAt: 1 }, limit: 20 }],
    ['queue: unread replies', 'conversations', () => ({ ...T(), unreadCount: { $gt: 0 } }), { sort: { lastInboundAt: 1 }, limit: 100 }],
    ['lead detail: timeline', 'activities', () => ({ ...T(), leadId: newObjectId() }), { sort: { occurredAt: -1 }, limit: 50 }],
    ['lead detail: conversations', 'conversations', () => ({ ...T(), leadId: newObjectId() })],
    ['thread: messages', 'messages', () => ({ ...T(), conversationId: newObjectId() }), { sort: { createdAt: 1 }, limit: 100 }],
    ['intake: dedupe lookup', 'leadcontactindexes', () => ({ ...T(), kind: 'phone', valueNorm: { $in: ['+919000000100'] } })],
    ['pulse: cohort leads', 'leads', () => ({ ...T(), createdAt: { $gte: day(7), $lt: new Date(now) }, deletedAt: null })],
    ['pulse: untouched', 'leads', () => ({ ...T(), deletedAt: null, firstContactedAt: null, createdAt: { $lt: day(1) }, $or: [{ statusId: { $in: openIds() } }, { statusId: null }] }), { sort: { createdAt: 1 }, limit: 200 }],
    ['pulse: calls in window', 'callsessions', () => ({ ...T(), startedAt: { $gte: day(7), $lt: new Date(now) } })],
    ['pulse: tasks due in window', 'tasks', () => ({ ...T(), dueAt: { $gte: day(7), $lt: new Date(now) }, status: { $in: ['open', 'done', 'missed'] } })],
    ['pulse: missed tasks', 'tasks', () => ({ ...T(), status: 'missed' }), { sort: { dueAt: 1 }, limit: 200 }],
    ['pulse: sends last 24h', 'messages', () => ({ ...T(), direction: 'out', createdAt: { $gte: day(1) } })],
    ['sweeper: overdue tasks (all tenants)', 'tasks', () => ({ status: 'open', dueAt: { $lt: new Date(now) } }), { sort: { dueAt: 1 }, limit: 500 }],
    ['sweeper: claim timers (all tenants)', 'leads', () => ({ 'sla.state': 'awaiting_claim', 'sla.claimDueAt': { $lt: new Date(now) }, deletedAt: null }), { limit: 500 }],
    ['sweeper: due enrollments (all tenants)', 'cadenceenrollments', () => ({ state: 'active', nextRunAt: { $lte: new Date(now) } }), { sort: { nextRunAt: 1 }, limit: 500 }],
    ['sweeper: outbox claim', 'events', () => ({ dispatchedAt: null, $or: [{ claimedUntil: null }, { claimedUntil: { $lt: new Date(now) } }] }), { sort: { _id: 1 }, limit: 1 }],
    ['health: pending webhooks', 'integrationinboxes', () => ({ ...T(), status: { $in: ['received', 'processing', 'failed'] } }), { sort: { receivedAt: 1 }, limit: 1 }],
  ];
  for (const [label, name, filter, o] of cases) {
    it(label, async () => {
      const p = await explain(name, filter(), o ?? {});
      expect(p.stages, `${label}: ${p.stages.join('>')}`).not.toContain('COLLSCAN');
      // a blocking in-memory sort is only acceptable over a small candidate set
      if (p.stages.includes('SORT')) expect(p.docs, `${label} sorts ${p.docs} docs in memory`).toBeLessThanOrEqual(1000);
      // selectivity: we may examine more than we return, but never the whole tenant for a handful of rows
      expect(p.docs, `${label} examined ${p.docs} docs for ${p.returned} returned (${p.stages.join('>')})`).toBeLessThanOrEqual(Math.max(1500, p.returned * 8));
    });
  }
});

// ---------- 2. latency budgets through the real HTTP stack ----------
async function p95(fn: () => Promise<unknown>, n = 25) {
  await fn(); const t: number[] = [];
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b); return { p50: t[Math.floor(n * 0.5)], p95: t[Math.floor(n * 0.95)] };
}
describe(`API latency budgets with ${N * 3} leads in the database (p95)`, () => {
  const budget = Number(process.env.PERF_BUDGET_MS ?? 300);
  it('lead list < 300 ms (owner) and agent-scoped list', async () => {
    expect((await p95(() => request(http).get('/v1/leads').set(auth(token)).expect(200))).p95).toBeLessThan(budget);
    expect((await p95(() => request(http).get('/v1/leads').set(auth(agentTok)).expect(200))).p95).toBeLessThan(budget);
  });
  it('search by phone fragment and by name < 300 ms', async () => {
    expect((await p95(() => request(http).get('/v1/leads').query({ q: '90000001' }).set(auth(token)).expect(200))).p95).toBeLessThan(budget);
    expect((await p95(() => request(http).get('/v1/leads').query({ q: 'lead 1' }).set(auth(token)).expect(200))).p95).toBeLessThan(budget);
  });
  it('Today queue < 300 ms for an agent with ~2k leads', async () => {
    const q = (await request(http).get('/v1/do/queue').set(auth(agentTok)).expect(200)).body; expect(q.total).toBeGreaterThan(50);
    expect((await p95(() => request(http).get('/v1/do/queue').set(auth(agentTok)).expect(200))).p95).toBeLessThan(budget);
  });
  it('lead detail < 400 ms', async () => {
    const id = (await request(http).get('/v1/leads').set(auth(token)).expect(200)).body.items[0]._id;
    expect((await p95(() => request(http).get(`/v1/leads/${id}`).set(auth(token)).expect(200))).p95).toBeLessThan(400);
    expect((await p95(() => request(http).get(`/v1/leads/${id}/timeline`).set(auth(token)).expect(200))).p95).toBeLessThan(400);
  });
  it('Pulse home (heavier, manager-only) stays under 2 s', async () => {
    for (const path of ['/v1/pulse/kpis?range=7d', '/v1/pulse/team', '/v1/pulse/leakage', '/v1/pulse/sources']) {
      const r = await p95(() => request(http).get(path).set(auth(token)).expect(200), 6); expect(r.p95, path).toBeLessThan(2000);
    }
  });
});

// ---------- 3. no N+1: command counts must not grow with the number of rows returned ----------
describe('no N+1 queries', () => {
  async function commands(fn: () => Promise<unknown>) {
    const { TENANT_DB } = await import('@leaddesk/platform'); const client = (app.get(TENANT_DB) as any).conn.getClient(); const seen: string[] = [];
    const on = (e: any) => { if (!['hello', 'isMaster', 'ping', 'endSessions', 'saslContinue', 'saslStart'].includes(e.commandName)) seen.push(e.commandName); };
    client.on('commandStarted', on); try { await fn(); } finally { client.off('commandStarted', on); }
    return seen.length;
  }
  it('listing 10 or 50 leads costs the same number of database commands', async () => {
    await request(http).get('/v1/leads').set(auth(token)); // warm caches (membership, statuses)
    const small = await commands(() => request(http).get('/v1/leads').query({ limit: 10 }).set(auth(token)).expect(200));
    const large = await commands(() => request(http).get('/v1/leads').query({ limit: 50 }).set(auth(token)).expect(200));
    expect(large).toBe(small); expect(large).toBeLessThanOrEqual(8);
  });
  it('the queue builds from a bounded number of queries regardless of how many items it returns', async () => {
    await request(http).get('/v1/do/queue').set(auth(agentTok));
    const few = await commands(() => request(http).get('/v1/do/queue').query({ limit: 5 }).set(auth(agentTok)).expect(200));
    const many = await commands(() => request(http).get('/v1/do/queue').query({ limit: 200 }).set(auth(agentTok)).expect(200));
    expect(many).toBe(few); expect(many).toBeLessThanOrEqual(30);
  });
});
