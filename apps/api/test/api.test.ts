import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('api_test');
  process.env.JWT_ACCESS_SECRET = 'test-access';
  process.env.LOCAL_KEK_BASE64 = randomBytes(32).toString('base64');
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/setup');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = app.getHttpServer();
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

const signup = async (n: string) => {
  const r = await request(http).post('/v1/auth/signup').send({ email: `${n}@x.io`, password: 'correct-horse-9', name: n, tenantName: `Co ${n}` }).expect(201);
  return { token: r.body.accessToken as string, tenantId: r.body.tenantId as string, cookie: r.headers['set-cookie'] as unknown as string[] };
};
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('auth', () => {
  it('rejects unauthenticated access', async () => { await request(http).get('/v1/me').expect(401); await request(http).get('/v1/connections').expect(401); });
  it('signup -> me, login, refresh rotation + reuse detection, logout', async () => {
    const s = await signup('alice');
    expect((await request(http).get('/v1/me').set(auth(s.token)).expect(200)).body.role).toBe('owner');
    expect(s.cookie.join(';')).toMatch(/HttpOnly/i);
    await request(http).post('/v1/auth/login').send({ email: 'alice@x.io', password: 'wrong-password-1' }).expect(401);
    const login = await request(http).post('/v1/auth/login').send({ email: 'alice@x.io', password: 'correct-horse-9' }).expect(200);
    const c1 = (login.headers['set-cookie'] as unknown as string[])[0];
    const r1 = await request(http).post('/v1/auth/refresh').set('Cookie', c1).expect(200);
    const c2 = (r1.headers['set-cookie'] as unknown as string[])[0];
    expect(c2).not.toBe(c1);
    await request(http).post('/v1/auth/refresh').set('Cookie', c1).expect(401); // replay of rotated token
    await request(http).post('/v1/auth/refresh').set('Cookie', c2).expect(401); // family revoked
    const login2 = await request(http).post('/v1/auth/login').send({ email: 'alice@x.io', password: 'correct-horse-9' }).expect(200);
    const c3 = (login2.headers['set-cookie'] as unknown as string[])[0];
    await request(http).post('/v1/auth/logout').set('Cookie', c3).expect(204);
    await request(http).post('/v1/auth/refresh').set('Cookie', c3).expect(401);
  });
  it('rejects forged tenant in refresh token and duplicate signup', async () => {
    await request(http).post('/v1/auth/refresh').set('Cookie', 'ld_refresh=aaaaaaaaaaaaaaaaaaaaaaaa.zzz').expect(401);
    await signup('dup');
    await request(http).post('/v1/auth/signup').send({ email: 'dup@x.io', password: 'correct-horse-9', name: 'd', tenantName: 'Again' }).expect(409);
  });
});

describe('invitations & RBAC', () => {
  it('agent flow: invite -> accept -> agent has limited permissions', async () => {
    const owner = await signup('boss');
    const inv = await request(http).post('/v1/invitations').set(auth(owner.token)).send({ email: 'agent1@x.io', role: 'agent' }).expect(201);
    const acc = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Ag', password: 'agent-pass-123' }).expect(201);
    expect(acc.body.role).toBe('agent');
    expect(acc.body.tenantId).toBe(owner.tenantId);
    await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Ag', password: 'agent-pass-123' }).expect(400); // single use
    const a = acc.body.accessToken;
    await request(http).get('/v1/connections').set(auth(a)).expect(403);
    await request(http).post('/v1/invitations').set(auth(a)).send({ email: 'z@x.io', role: 'agent' }).expect(403);
  });
  it('a manager cannot invite an admin (no privilege escalation)', async () => {
    const owner = await signup('boss2');
    const inv = await request(http).post('/v1/invitations').set(auth(owner.token)).send({ email: 'mgr@x.io', role: 'manager' }).expect(201);
    const mgr = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'M', password: 'manager-pass-1' }).expect(201)).body.accessToken;
    await request(http).post('/v1/invitations').set(auth(mgr)).send({ email: 'adm@x.io', role: 'admin' }).expect(403);
    await request(http).post('/v1/invitations').set(auth(mgr)).send({ email: 'ag2@x.io', role: 'agent' }).expect(201);
    await request(http).get('/v1/connections').set(auth(mgr)).expect(200); // view ok, manage not
    await request(http).post('/v1/connections').set(auth(mgr)).send({ provider: 'x', category: 'lead_source', name: 'n', secret: 's' }).expect(403);
  });
  it('invitation token from tenant A cannot be tampered into tenant B', async () => {
    const a = await signup('ta'); const b = await signup('tb');
    const inv = await request(http).post('/v1/invitations').set(auth(a.token)).send({ email: 'p@x.io', role: 'agent' }).expect(201);
    const forged = `${b.tenantId}.${String(inv.body.inviteToken).split('.')[1]}`;
    await request(http).post(`/v1/invitations/${forged}/accept`).send({ name: 'P', password: 'agent-pass-123' }).expect(400);
  });
});

describe('connections: secrets are write-only and tenant isolated', () => {
  it('never returns the secret; other tenant cannot see it', async () => {
    const a = await signup('conna'); const b = await signup('connb');
    const created = await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', category: 'lead_source', name: 'Site', secret: 'super-secret-9876' }).expect(201);
    expect(JSON.stringify(created.body)).not.toContain('super-secret');
    expect(created.body.secretHint).toBe('••••9876');
    const listA = await request(http).get('/v1/connections').set(auth(a.token)).expect(200);
    expect(listA.body).toHaveLength(1);
    expect(JSON.stringify(listA.body)).not.toMatch(/secretCiphertext|secretWrappedDek|super-secret/);
    expect((await request(http).get('/v1/connections').set(auth(b.token)).expect(200)).body).toHaveLength(0);
  });
  it('decrypts at call time through the service (BSON Binary round trip), and not across tenants', async () => {
    const { ConnectionsService } = await import('../src/connections/connections.module');
    const { runWithTenant } = await import('@leaddesk/db');
    const svc = app.get(ConnectionsService);
    const a = await signup('wa'); const b = await signup('wb');
    const made = await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'x', category: 'lead_source', name: 'n', secret: 'plain-secret-4321' }).expect(201);
    expect(await runWithTenant(a.tenantId, () => svc.withSecret(made.body.id, async (s) => s))).toBe('plain-secret-4321');
    await expect(runWithTenant(b.tenantId, () => svc.withSecret(made.body.id, async (s) => s))).rejects.toThrow('Connection not found');
  });
});

describe('leads API (phase 1a)', () => {
  const mkAgent = async (owner: { token: string }, email: string) => {
    const inv = await request(http).post('/v1/invitations').set(auth(owner.token)).send({ email, role: 'agent' }).expect(201);
    return (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Ag', password: 'agent-pass-123' }).expect(201)).body as { accessToken: string };
  };
  it('signup seeds the preset; create/get/update/status flow; agents see masked contacts', async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'lead-owner@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'RE Co', industryPreset: 'real_estate' }).expect(201);
    const owner = { token: o.body.accessToken as string };
    const statuses = (await request(http).get('/v1/statuses').set(auth(owner.token)).expect(200)).body;
    expect(statuses.map((s: any) => s.name)).toContain('Site Visit Scheduled');

    const created = await request(http).post('/v1/leads').set(auth(owner.token)).send({ name: 'Anil', contacts: [{ value: '9876501234' }] }).expect(201);
    expect(created.body.outcome).toBe('created');
    const id = created.body.leadId;
    const full = (await request(http).get(`/v1/leads/${id}`).set(auth(owner.token)).expect(200)).body;
    expect(JSON.stringify(full)).toContain('+919876501234');

    await request(http).patch(`/v1/leads/${id}`).set(auth(owner.token)).send({ custom: { bhk: '99' } }).expect(422).expect((r) => expect(r.body.code).toBe('invalid_custom_fields'));
    await request(http).patch(`/v1/leads/${id}`).set(auth(owner.token)).send({ custom: { bhk: '3' }, city: 'Pune' }).expect(200);
    const lost = statuses.find((s: any) => s.kind === 'lost');
    await request(http).post(`/v1/leads/${id}/status`).set(auth(owner.token)).send({ statusId: lost._id }).expect(422).expect((r) => expect(r.body.code).toBe('status_requirements_not_met'));
    const tl = (await request(http).get(`/v1/leads/${id}/timeline`).set(auth(owner.token)).expect(200)).body;
    expect(tl.items.map((a: any) => a.type)).toEqual(expect.arrayContaining(['lead_created', 'field_changed']));

    // an agent owns what they create, sees it masked, and cannot see others' leads
    const agent = await mkAgent(owner, 'lead-agent@x.io');
    const mine = (await request(http).post('/v1/leads').set(auth(agent.accessToken)).send({ name: 'Mine', contacts: [{ value: '9876502222' }] }).expect(201)).body.leadId;
    const view = (await request(http).get(`/v1/leads/${mine}`).set(auth(agent.accessToken)).expect(200)).body;
    expect(JSON.stringify(view)).not.toMatch(/9876502222|valueNorm|valueRaw|phoneNorms/);
    expect(JSON.stringify(view)).toContain('••');
    await request(http).get(`/v1/leads/${id}`).set(auth(agent.accessToken)).expect(403);
    await request(http).post(`/v1/leads/${mine}/merge`).set(auth(agent.accessToken)).send({ loserId: id }).expect(403);
    await request(http).delete(`/v1/leads/${mine}`).set(auth(agent.accessToken)).expect(403);
  });
  it('other tenants cannot read or change a lead (404, not 403: no existence leak)', async () => {
    const a = await signup('lt-a'); const b = await signup('lt-b');
    const id = (await request(http).post('/v1/leads').set(auth(a.token)).send({ contacts: [{ value: '9876503333' }] }).expect(201)).body.leadId;
    await request(http).get(`/v1/leads/${id}`).set(auth(b.token)).expect(404);
    await request(http).patch(`/v1/leads/${id}`).set(auth(b.token)).send({ city: 'x' }).expect(404);
    await request(http).get(`/v1/leads/${id}/timeline`).set(auth(b.token)).expect(404);
  });
  it('merge + undo via API is audited and manager+ only', async () => {
    const o = await signup('merge-o');
    const x = (await request(http).post('/v1/leads').set(auth(o.token)).send({ name: 'X', contacts: [{ value: '9876504441' }] })).body.leadId;
    const y = (await request(http).post('/v1/leads').set(auth(o.token)).send({ name: 'Y', contacts: [{ value: '9876504442' }] })).body.leadId;
    const m = await request(http).post(`/v1/leads/${x}/merge`).set(auth(o.token)).send({ loserId: y }).expect(201);
    await request(http).get(`/v1/leads/${y}`).set(auth(o.token)).expect(404);
    await request(http).post(`/v1/merges/${m.body.mergeId}/undo`).set(auth(o.token)).expect(201);
    await request(http).get(`/v1/leads/${y}`).set(auth(o.token)).expect(200);
  });
});

describe('search, views, bulk, export, offboarding (phase 1b)', () => {
  let owner: string; let agentTok: string; let agentId: string; let agent2Tok: string; let agent2Id: string;
  const mkAgent = async (email: string) => {
    const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email, role: 'agent' }).expect(201);
    const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: email, password: 'agent-pass-123' }).expect(201);
    const me = await request(http).get('/v1/me').set(auth(r.body.accessToken)).expect(200);
    return { tok: r.body.accessToken as string, id: me.body.userId as string };
  };
  beforeAll(async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'p1b@x.io', password: 'correct-horse-9', name: 'Owner', tenantName: 'P1B Co' }).expect(201);
    owner = o.body.accessToken;
    ({ tok: agentTok, id: agentId } = await mkAgent('p1b-a1@x.io'));
    ({ tok: agent2Tok, id: agent2Id } = await mkAgent('p1b-a2@x.io'));
    for (const [n, p, city] of [['Priya Sharma', '9810000001', 'Delhi'], ['Rahul Verma', '9810000002', 'Pune'], ['Priyanka Rao', '9810000003', 'Pune']] as const)
      await request(http).post('/v1/leads').set(auth(owner)).send({ name: n, city, contacts: [{ value: p }] }).expect(201);
  });

  it('searches by name word prefix and by phone fragments; agents need >= 6 digits', async () => {
    const byName = (await request(http).get('/v1/leads').query({ q: 'priy' }).set(auth(owner)).expect(200)).body;
    expect(byName.items.map((l: any) => l.displayName).sort()).toEqual(['Priya Sharma', 'Priyanka Rao']);
    expect((await request(http).get('/v1/leads').query({ q: 'sharma pri' }).set(auth(owner)).expect(200)).body.items).toHaveLength(1);
    expect((await request(http).get('/v1/leads').query({ q: '9810000002' }).set(auth(owner)).expect(200)).body.items[0].displayName).toBe('Rahul Verma');
    expect((await request(http).get('/v1/leads').query({ q: '+91 98100 00003' }).set(auth(owner)).expect(200)).body.items[0].displayName).toBe('Priyanka Rao');
    expect((await request(http).get('/v1/leads').query({ q: '0000003' }).set(auth(owner)).expect(200)).body.items[0].displayName).toBe('Priyanka Rao'); // suffix
    expect((await request(http).get('/v1/leads').query({ q: '98100' }).set(auth(owner)).expect(200)).body.items).toHaveLength(3); // prefix
    await request(http).get('/v1/leads').query({ q: '9810' }).set(auth(agentTok)).expect(422).expect((r) => expect(r.body.code).toBe('search_too_short'));
  });
  it('regex metacharacters in search are inert; unknown filters rejected', async () => {
    await request(http).get('/v1/leads').query({ q: '.*' }).set(auth(owner)).expect(422); // punctuation-only is an empty search, never a regex
    expect((await request(http).get('/v1/leads').query({ q: 'zzz.*' }).set(auth(owner)).expect(200)).body.items).toHaveLength(0);
    expect((await request(http).get('/v1/leads').query({ city: '.*' }).set(auth(owner)).expect(200)).body.items).toHaveLength(0);
    await request(http).post('/v1/views').set(auth(owner)).send({ name: 'bad', filter: { $where: '1' } }).expect(422);
  });
  it('cursor pagination walks all rows exactly once', async () => {
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = (await request(http).get('/v1/leads').query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(auth(owner)).expect(200)).body;
      seen.push(...r.items.map((l: any) => l._id));
      if (!r.nextCursor) break; cursor = r.nextCursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(3);
  });
  it('agents only list their own leads, masked; unassigned leads are invisible to them', async () => {
    expect((await request(http).get('/v1/leads').set(auth(agentTok)).expect(200)).body.items).toHaveLength(0);
    const mine = (await request(http).post('/v1/leads').set(auth(agentTok)).send({ name: 'Agent Lead', contacts: [{ value: '9820000001' }] }).expect(201)).body.leadId;
    const list = (await request(http).get('/v1/leads').set(auth(agentTok)).expect(200)).body;
    expect(list.items.map((l: any) => l._id)).toEqual([mine]);
    expect(JSON.stringify(list)).not.toMatch(/9820000001|valueNorm|phoneNorms/);
    expect((await request(http).get('/v1/leads').set(auth(agent2Tok)).expect(200)).body.items).toHaveLength(0);
    // an agent searching for a number that belongs to someone else's lead finds nothing
    expect((await request(http).get('/v1/leads').query({ q: '9810000001' }).set(auth(agentTok)).expect(200)).body.items).toHaveLength(0);
  });
  it('saved views: validated, private/shared rules', async () => {
    const v = (await request(http).post('/v1/views').set(auth(owner)).send({ name: 'Pune', filter: { city: 'Pune' }, shared: true }).expect(201)).body;
    expect((await request(http).get('/v1/leads').query({ viewId: v._id }).set(auth(owner)).expect(200)).body.items).toHaveLength(2);
    await request(http).post('/v1/views').set(auth(agentTok)).send({ name: 'x', filter: {}, shared: true }).expect(403);
    expect((await request(http).get('/v1/views').set(auth(agentTok)).expect(200)).body.map((x: any) => x.name)).toContain('Pune');
    await request(http).delete(`/v1/views/${v._id}`).set(auth(agentTok)).expect(403);
  });
  it('assign + bulk: agents cannot reassign; bulk respects visibility', async () => {
    const all = (await request(http).get('/v1/leads').set(auth(owner)).expect(200)).body.items;
    const target = all.find((l: any) => l.displayName === 'Rahul Verma')._id;
    await request(http).post(`/v1/leads/${target}/assign`).set(auth(agentTok)).send({ ownerId: agentId }).expect(403);
    await request(http).post(`/v1/leads/${target}/assign`).set(auth(owner)).send({ ownerId: agent2Id }).expect(201);
    expect((await request(http).get('/v1/leads').set(auth(agent2Tok)).expect(200)).body.items.map((l: any) => l._id)).toContain(target);
    const b = (await request(http).post('/v1/leads/bulk').set(auth(agentTok)).send({ ids: [target], action: 'tag', tag: 'hot' }).expect(201)).body;
    expect(b.updated).toBe(0); expect(b.failed[0].reason).toMatch(/not visible/);
    const b2 = (await request(http).post('/v1/leads/bulk').set(auth(owner)).send({ ids: [target], action: 'tag', tag: 'hot' }).expect(201)).body;
    expect(b2.updated).toBe(1);
    await request(http).post('/v1/leads/bulk').set(auth(agentTok)).send({ ids: [target], action: 'delete' }).expect(403);
    await request(http).post('/v1/leads/assign-nope').set(auth(owner)).expect(404);
  });
  it('export: managers/admins only, audited, formula-injection safe', async () => {
    await request(http).post('/v1/leads').set(auth(owner)).send({ name: '=HYPERLINK("http://evil")', contacts: [{ value: '9830000001' }] }).expect(201);
    await request(http).get('/v1/leads-export').set(auth(agentTok)).expect(403);
    const csv = (await request(http).get('/v1/leads-export').set(auth(owner)).expect(200)).text;
    expect(csv.split('\n')[0]).toBe('id,name,phones,emails,city,tags,createdAt');
    expect(csv).toContain('+919830000001');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });
  it('offboarding: deactivates, kills the live token immediately, reassigns open leads round-robin', async () => {
    const x = await mkAgent('p1b-off@x.io'); const y = await mkAgent('p1b-y@x.io');
    for (let i = 0; i < 4; i++) await request(http).post('/v1/leads').set(auth(x.tok)).send({ name: `Off ${i}`, contacts: [{ value: `98400000${i}0` }] }).expect(201);
    expect((await request(http).get('/v1/leads').set(auth(x.tok)).expect(200)).body.items).toHaveLength(4);
    await request(http).post(`/v1/users/${x.id}/offboard`).set(auth(agentTok)).send({}).expect(403);
    await request(http).post(`/v1/users/${x.id}/offboard`).set(auth(owner)).send({ poolUserIds: [x.id] }).expect(422);
    const r = await request(http).post(`/v1/users/${x.id}/offboard`).set(auth(owner)).send({ poolUserIds: [y.id, agent2Id] }).expect(201);
    expect(r.body).toEqual({ reassigned: 4, unassigned: 0 });
    await request(http).get('/v1/me').set(auth(x.tok)).expect(401); // token dead right away
    expect((await request(http).get('/v1/leads').query({ ownerId: y.id }).set(auth(owner)).expect(200)).body.items.filter((l: any) => l.displayName.startsWith('Off'))).toHaveLength(2);
    const users = (await request(http).get('/v1/users').set(auth(owner)).expect(200)).body;
    expect(users.find((u: any) => u.userId === x.id).status).toBe('inactive');
    await request(http).post('/v1/auth/login').send({ email: 'p1b-off@x.io', password: 'agent-pass-123' }).expect(401); // no active membership
    // history preserved: reassignment is on each lead's timeline
    const any = (await request(http).get('/v1/leads').query({ q: 'Off 0' }).set(auth(owner)).expect(200)).body.items[0];
    expect((await request(http).get(`/v1/leads/${any._id}/timeline`).set(auth(owner)).expect(200)).body.items.map((a: any) => a.type)).toContain('reassigned');
    // owner cannot be offboarded
    const me = (await request(http).get('/v1/me').set(auth(owner)).expect(200)).body.userId;
    await request(http).post(`/v1/users/${me}/offboard`).set(auth(owner)).send({}).expect(422);
  });
});
