import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nodeHttp from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any;
/** Switchboard so individual tests can script provider (Meta/Google) responses. Documented shapes, not live traffic. */
let providerFetch: (url: string, init?: any) => Promise<any> = async () => ({ ok: false, status: 404, text: async () => '{}' });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('api_test');
  process.env.JWT_ACCESS_SECRET = 'test-access';
  process.env.LOCAL_KEK_BASE64 = randomBytes(32).toString('base64');
  Object.assign(process.env, { META_APP_ID: 'APP1', META_APP_SECRET: 'meta-secret', META_WEBHOOK_VERIFY_TOKEN: 'vt', GOOGLE_CLIENT_ID: 'gcid', GOOGLE_CLIENT_SECRET: 'gsec', PUBLIC_API_URL: 'https://api.example.test', PUBLIC_INGRESS_URL: 'https://hooks.example.test', OBJECT_SIGNING_SECRET: 'test-signing-secret-0123456789', RECORDINGS_DIR: mkdtempSync(join(tmpdir(), 'ld-rec-')) });
  delete process.env.PUBLIC_APP_URL;
  process.env.REALTIME_POLL_MS = '80';
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/setup');
  const { HTTP_FETCH } = await import('../src/connections/connections.module');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(HTTP_FETCH).useValue((u: string, i?: any) => providerFetch(u, i)).compile();
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

describe('connections (phase 2a): manifest-driven, secrets write-only, tenant isolated', () => {
  it('lists connectors; creating generates and reveals the signing secret exactly once', async () => {
    const a = await signup('conna'); const b = await signup('connb');
    const connectors = (await request(http).get('/v1/connectors').set(auth(a.token)).expect(200)).body;
    expect(connectors.map((c: any) => c.id)).toContain('website-webhook');
    expect(JSON.stringify(connectors)).not.toMatch(/verify|function/);
    const created = (await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', name: 'Site' }).expect(201)).body;
    expect(created.connection.status).toBe('verified');
    expect(created.revealedOnce.signingSecret).toHaveLength(43);
    expect(created.connection.webhookPath).toMatch(/^\/hooks\/website-webhook\/.{20,}/);
    const listA = await request(http).get('/v1/connections').set(auth(a.token)).expect(200);
    expect(listA.body).toHaveLength(1);
    expect(JSON.stringify(listA.body)).not.toContain(created.revealedOnce.signingSecret);
    expect(JSON.stringify(listA.body)).not.toMatch(/secretCiphertext|secretWrappedDek/);
    expect((await request(http).get('/v1/connections').set(auth(b.token)).expect(200)).body).toHaveLength(0);
    await request(http).post(`/v1/connections/${created.connection.id}/verify`).set(auth(b.token)).expect(404);
    await request(http).get(`/v1/connections/${created.connection.id}/logs`).set(auth(b.token)).expect(404);
    await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'nope', name: 'x' }).expect(422);
    await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', name: 'x', credentials: { bogus: '1' } }).expect(422);
  });
  it('test lead goes end to end through the intake pipeline; logs and health are recorded', async () => {
    const a = await signup('conntest');
    const c = (await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', name: 'Landing' }).expect(201)).body.connection;
    const t = (await request(http).post(`/v1/connections/${c.id}/test`).set(auth(a.token)).send({}).expect(201)).body;
    expect(t.status).toBe('done'); expect(t.leads[0].outcome).toBe('created');
    const leads = (await request(http).get('/v1/leads').set(auth(a.token)).expect(200)).body.items;
    expect(leads[0].displayName).toBe('Test Lead (safe to delete)');
    const h = (await request(http).get(`/v1/connections/${c.id}/health`).set(auth(a.token)).expect(200)).body;
    expect(h.checks.some((x: any) => x.check === 'verify' && x.ok)).toBe(true);
    expect(h.connection.lastEventAt).toBeTruthy();
    const logs = (await request(http).get(`/v1/connections/${c.id}/logs`).set(auth(a.token)).expect(200)).body;
    expect(logs.map((l: any) => l.message)).toEqual(expect.arrayContaining(['Connection created', 'Verified']));
  });
  it('needs-attention list, fix mapping, replay', async () => {
    const a = await signup('connfix');
    const c = (await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', name: 'Odd form' }).expect(201)).body.connection;
    // a payload whose phone lives under an unrecognised key => rejected, not silently dropped
    const bad = (await request(http).post(`/v1/connections/${c.id}/test`).set(auth(a.token)).send({ fields: { id: 'x1', fullname: 'Odd', zz_digits: '9876543210' } }).expect(201)).body;
    expect(bad.status).toBe('failed');
    const failed = (await request(http).get('/v1/inbox').set(auth(a.token)).expect(200)).body;
    expect(failed).toHaveLength(1); expect(failed[0].error).toMatch(/rejected/i);
    await request(http).put(`/v1/connections/${c.id}/config`).set(auth(a.token)).send({ config: { fieldMapping: JSON.stringify({ zz_digits: 'phone', fullname: 'name' }) } }).expect(200);
    const re = (await request(http).post(`/v1/inbox/${failed[0]._id}/replay`).set(auth(a.token)).expect(201)).body;
    expect(re.status).toBe('done'); expect(re.leads[0].outcome).toBe('created');
    expect((await request(http).get('/v1/inbox').set(auth(a.token)).expect(200)).body).toHaveLength(0);
    await request(http).put(`/v1/connections/${c.id}/config`).set(auth(a.token)).send({ config: { evil: 1 } }).expect(422);
  });
  it('reconnect re-verifies before swapping; revoke blocks verify; managers can view but not manage', async () => {
    const a = await signup('connrev');
    const c = (await request(http).post('/v1/connections').set(auth(a.token)).send({ provider: 'website-webhook', name: 'R' }).expect(201)).body.connection;
    const r = (await request(http).post(`/v1/connections/${c.id}/reconnect`).set(auth(a.token)).send({ credentials: { signingSecret: 'brand-new-secret-9999' } }).expect(201)).body;
    expect(r.connection.secretHint).toBe('••••9999');
    await request(http).post(`/v1/connections/${c.id}/reconnect`).set(auth(a.token)).send({ credentials: { signingSecret: '' } }).expect(201); // blank => regenerated
    await request(http).delete(`/v1/connections/${c.id}`).set(auth(a.token)).expect(200);
    await request(http).post(`/v1/connections/${c.id}/verify`).set(auth(a.token)).expect(422);
    const inv = await request(http).post('/v1/invitations').set(auth(a.token)).send({ email: 'connrev-m@x.io', role: 'manager' }).expect(201);
    const mgr = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'M', password: 'manager-pass-1' }).expect(201)).body.accessToken;
    await request(http).get('/v1/connections').set(auth(mgr)).expect(200);
    await request(http).post('/v1/connections').set(auth(mgr)).send({ provider: 'website-webhook', name: 'z' }).expect(403);
    await request(http).get('/v1/inbox').set(auth(mgr)).expect(403);
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

describe('imports API (phase 1c)', () => {
  const waitDone = async (tok: string, id: string) => {
    for (let i = 0; i < 100; i++) {
      const r = (await request(http).get(`/v1/imports/${id}`).set(auth(tok)).expect(200)).body;
      if (r.status === 'done' || r.status === 'failed') return r;
      await new Promise((r2) => setTimeout(r2, 50));
    }
    throw new Error('import did not finish');
  };
  it('upload -> mapping -> dry run -> run -> poll -> error csv; agents are forbidden', async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'imp@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'Imp Co', industryPreset: 'real_estate' }).expect(201);
    const tok = o.body.accessToken as string;
    const inv = await request(http).post('/v1/invitations').set(auth(tok)).send({ email: 'imp-agent@x.io', role: 'agent' }).expect(201);
    const agent = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'A', password: 'agent-pass-123' }).expect(201)).body.accessToken;

    const csv = 'Name,Mobile,City,BHK\nA One,9810011111,Pune,2\nA Two,12345,Pune,\nA Three,9810033333,Delhi,99\n';
    await request(http).post('/v1/imports').set(auth(agent)).attach('file', Buffer.from(csv), 'l.csv').expect(403);
    await request(http).post('/v1/imports').set(auth(tok)).expect(400);
    await request(http).post('/v1/imports').set(auth(tok)).attach('file', Buffer.from('x'), 'l.pdf').expect(415);
    const up = (await request(http).post('/v1/imports').set(auth(tok)).attach('file', Buffer.from(csv), 'l.csv').expect(201)).body;
    expect(up.rowCount).toBe(3);
    expect(up.suggestedMapping).toMatchObject({ Name: 'name', Mobile: 'phone', City: 'city', BHK: 'custom.bhk' });
    await request(http).post(`/v1/imports/${up.id}/run`).set(auth(tok)).send({}).expect(409); // no mapping yet
    await request(http).put(`/v1/imports/${up.id}/mapping`).set(auth(tok)).send({ mapping: { Name: 'name' } }).expect(422);
    await request(http).put(`/v1/imports/${up.id}/mapping`).set(auth(tok)).send({ mapping: up.suggestedMapping }).expect(200);
    const dry = (await request(http).post(`/v1/imports/${up.id}/dry-run`).set(auth(tok)).expect(201)).body;
    expect(dry).toMatchObject({ total: 3, new: 1, invalid: 2 });
    expect((await request(http).get('/v1/leads').set(auth(tok)).expect(200)).body.items).toHaveLength(0);
    await request(http).post(`/v1/imports/${up.id}/run`).set(auth(tok)).send({ dedupePolicy: 'merge' }).expect(201);
    await request(http).post(`/v1/imports/${up.id}/run`).set(auth(tok)).send({}).expect(409); // double start refused
    const done = await waitDone(tok, up.id);
    expect(done.status).toBe('done');
    expect(done.stats.run).toMatchObject({ created: 1, rejected: 2 });
    expect((await request(http).get('/v1/leads').set(auth(tok)).expect(200)).body.items).toHaveLength(1);
    const errs = (await request(http).get(`/v1/imports/${up.id}/errors`).set(auth(tok)).expect(200)).text;
    expect(errs).toContain('A Two'); expect(errs).toContain('bhk must be one of');
    // another tenant cannot touch it
    const other = await signup('imp-other');
    await request(http).get(`/v1/imports/${up.id}`).set(auth(other.token)).expect(404);
    await request(http).get(`/v1/imports/${up.id}/errors`).set(auth(other.token)).expect(404);
  });
});

describe('notifications (phase 2b)', () => {
  it('admin-audience alerts reach admins only; reading is scoped; other tenants see nothing', async () => {
    const { TENANT_DB } = await import('@leaddesk/platform');
    const { DbNotifier } = await import('@leaddesk/domain');
    const { runWithTenant } = await import('@leaddesk/db');
    const db = app.get(TENANT_DB);
    const o = await signup('notif-o'); const other = await signup('notif-x');
    const inv = await request(http).post('/v1/invitations').set(auth(o.token)).send({ email: 'notif-agent@x.io', role: 'agent' }).expect(201);
    const agent = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'A', password: 'agent-pass-123' }).expect(201)).body.accessToken;
    const n = new DbNotifier(db);
    await runWithTenant(o.tenantId, () => n.notify({ kind: 'connection.degraded', audience: 'admins', payload: { name: 'Meta', reconnectPath: '/v1/connections/x/reconnect' }, dedupeKey: 'd1' }));
    await runWithTenant(o.tenantId, () => n.notify({ kind: 'connection.degraded', audience: 'admins', payload: {}, dedupeKey: 'd1' })); // duplicate: ignored
    const list = (await request(http).get('/v1/notifications').set(auth(o.token)).expect(200)).body;
    expect(list).toHaveLength(1); expect(list[0].kind).toBe('connection.degraded');
    expect((await request(http).get('/v1/notifications').set(auth(agent)).expect(200)).body).toHaveLength(0);
    expect((await request(http).get('/v1/notifications').set(auth(other.token)).expect(200)).body).toHaveLength(0);
    expect((await request(http).post(`/v1/notifications/${list[0]._id}/read`).set(auth(agent)).expect(201)).body.ok).toBe(false);
    expect((await request(http).post(`/v1/notifications/${list[0]._id}/read`).set(auth(o.token)).expect(201)).body.ok).toBe(true);
  });
});

describe('Meta Lead Ads + Google Sheets end to end (phase 2c, recorded-shape fixtures)', () => {
  const META_LEAD = { created_time: '2026-03-10T05:00:00+0000', id: '555001', ad_name: 'Ad One', adset_name: 'Pune 25-40', campaign_name: 'Summer Launch', form_id: 'f1',
    field_data: [{ name: 'full_name', values: ['Anita Desai'] }, { name: 'phone_number', values: ['+919812345678'] }, { name: 'email', values: ['anita@x.io'] }, { name: 'city', values: ['Pune'] }, { name: 'when_do_you_plan_to_buy?', values: ['this_month'] }] };
  const META_LEAD2 = { ...META_LEAD, id: '555002', field_data: [{ name: 'full_name', values: ['Second Person'] }, { name: 'phone_number', values: ['9811111111'] }] };
  const SID = 'b'.repeat(32);
  const subscribed: Record<string, string[]> = { P1: ['leadgen'] };
  const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });

  const fixtures = async (url: string, init?: any) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/v26\.0\//, ''); const q = u.searchParams;
    if (u.hostname === 'oauth2.googleapis.com') {
      if (q.get('grant_type') === 'refresh_token' || String(init?.body).includes('refresh_token')) return resp(200, { access_token: 'g-at', expires_in: 3600 });
      return resp(200, { access_token: 'g-at', refresh_token: 'g-refresh-token-1234' });
    }
    if (u.hostname === 'sheets.googleapis.com') {
      if (url.includes('/values/')) return resp(200, { values: [['Name', 'Mobile', 'City'], ['Sheet Asha', '9822200001', 'Pune'], ['', '', ''], ['Sheet Ravi', '9822200002', 'Delhi'], ['Sheet Mina', '9822200003']] });
      return resp(200, { properties: { title: 'Leads 2026' }, sheets: [{ properties: { title: 'Leads' } }] });
    }
    if (path === 'oauth/access_token') return resp(200, { access_token: q.get('grant_type') ? 'meta-long-lived' : 'meta-short', expires_in: 5184000 });
    if (path === 'debug_token') return resp(200, { data: { is_valid: true, app_id: 'APP1', expires_at: Math.floor(Date.now() / 1000) + 9 * 86400, scopes: ['leads_retrieval', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement'] } });
    if (path === 'me/accounts') return resp(200, { data: [{ id: 'P1', name: 'Acme Realty', access_token: 'ptok1' }, { id: 'P2', name: 'Acme Edu', access_token: 'ptok2' }] });
    if (path === 'me') return resp(200, { id: '1' });
    const sub = path.match(/^(P\d)\/subscribed_apps$/);
    if (sub && !init?.method) return resp(200, { data: subscribed[sub[1]]?.length ? [{ id: 'APP1', subscribed_fields: subscribed[sub[1]] }] : [] });
    if (sub) { subscribed[sub[1]] = ['leadgen']; return resp(200, { success: true }); }
    if (path === '555001') return resp(200, META_LEAD);
    if (path === 'P1/leadgen_forms') return resp(200, { data: [{ id: 'F1', name: 'Site visit form' }] });
    if (path === 'P2/leadgen_forms') return resp(200, { data: [] });
    if (path === 'F1/leads') return resp(200, { data: [META_LEAD, META_LEAD2] });
    return resp(404, { error: { code: 100, message: `unmocked ${path}` } });
  };
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

  it('connect with Meta: OAuth state is single-use and tenant-bound; verify discovers pages; webhook row becomes a lead with ad attribution', async () => {
    providerFetch = fixtures;
    const o = await request(http).post('/v1/auth/signup').send({ email: 'meta@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'Meta Co', industryPreset: 'real_estate' }).expect(201);
    const tok = o.body.accessToken as string;
    expect((await request(http).get('/v1/connectors').set(auth(tok)).expect(200)).body.map((c: any) => c.id)).toEqual(expect.arrayContaining(['meta-leadads', 'google-sheets']));

    const start = (await request(http).get('/v1/oauth/meta-leadads/start').set(auth(tok)).expect(200)).body;
    const url = new URL(start.url);
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('scope')).toContain('leads_retrieval');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/v1/oauth/meta-leadads/callback');
    const state = stateOf(start.url);

    await request(http).get('/v1/oauth/meta-leadads/callback').query({ code: 'x', state: 'bogus' }).expect(400);
    await request(http).get('/v1/oauth/meta-leadads/callback').query({ code: 'x', state: `${'a'.repeat(24)}.${state.split('.')[1]}` }).expect(400); // wrong tenant prefix
    const cbk = await request(http).get('/v1/oauth/meta-leadads/callback').query({ code: 'authcode', state }).expect(200);
    const conn = cbk.body.connection;
    expect(conn).toMatchObject({ provider: 'meta-leadads', status: 'verified' });
    expect(conn.config.pageIds).toEqual(['P1', 'P2']);
    expect(conn.oauthExpiresAt).toBeTruthy();
    expect(JSON.stringify(conn)).not.toMatch(/meta-long-lived|ptok1/);
    await request(http).get('/v1/oauth/meta-leadads/callback').query({ code: 'authcode', state }).expect(400); // replayed state
    const denied = (await request(http).get('/v1/oauth/meta-leadads/start').set(auth(tok)).expect(200)).body.url;
    await request(http).get('/v1/oauth/meta-leadads/callback').query({ error: 'access_denied', state: stateOf(denied) }).expect(422);

    // simulate the ingress storing a leadgen change, then process it
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const db = app.get(TENANT_DB);
    const row: any = await runWithTenant(o.body.tenantId, () => db.repos.inbox.create({ connectionId: conn.id, provider: 'meta-leadads', externalEventId: '555001', rawPayload: { leadgen_id: '555001', page_id: 'P1', form_id: 'f1' }, signatureValid: true, status: 'received' }));
    const done = (await request(http).post(`/v1/inbox/${row._id}/replay`).set(auth(tok)).expect(201)).body;
    expect(done.status).toBe('done'); expect(done.leads[0].outcome).toBe('created');
    const leads = (await request(http).get('/v1/leads').set(auth(tok)).expect(200)).body.items;
    expect(leads[0]).toMatchObject({ displayName: 'Anita Desai', campaign: 'Summer Launch', adSet: 'Pune 25-40', ad: 'Ad One', city: 'Pune', metaLeadId: '555001' });
    const tl = (await request(http).get(`/v1/leads/${leads[0]._id}/timeline`).set(auth(tok)).expect(200)).body.items;
    expect(tl.find((a: any) => a.type === 'lead_created').payload.answers['when_do_you_plan_to_buy?']).toBe('this_month');

    // integrity: P2's subscription was never created => heartbeat repairs it; backfill picks up the lead that never arrived by webhook
    const { IntegrityService } = await import('@leaddesk/domain'); const { KEY_SERVICE } = await import('@leaddesk/platform');
    const { REGISTRY } = await import('../src/connections/connections.module');
    const integ = new IntegrityService(db, app.get(KEY_SERVICE), app.get(REGISTRY));
    const hb = await runWithTenant(o.body.tenantId, () => integ.heartbeat(conn.id));
    expect(hb).toMatchObject({ status: 'verified', resubscribed: true });
    expect(subscribed.P2).toEqual(['leadgen']);
    const bf = await runWithTenant(o.body.tenantId, () => integ.backfill(conn.id, 2));
    expect(bf).toMatchObject({ seen: 2, missing: 1, ingested: 1, failed: 0 }); // 555001 already received; 555002 recovered
    expect((await request(http).get('/v1/leads').query({ q: 'second' }).set(auth(tok)).expect(200)).body.items).toHaveLength(1);
    expect((await runWithTenant(o.body.tenantId, () => db.repos.connections.findById(conn.id)) as any).lastEventAt).toBeTruthy();

    // the other tenant can't see any of it
    const other = await signup('meta-other');
    expect((await request(http).get('/v1/connections').set(auth(other.token)).expect(200)).body).toHaveLength(0);
    await request(http).post(`/v1/connections/${conn.id}/verify`).set(auth(other.token)).expect(404);
  });

  it('Google Sheets: PKCE consent, spreadsheet config, append-only sync with a persisted row cursor', async () => {
    providerFetch = fixtures;
    const o = await signup('sheets-owner');
    const start = (await request(http).get('/v1/oauth/google-sheets/start').query({ spreadsheetId: SID, sheetName: 'Leads', name: 'Facebook sheet' }).set(auth(o.token)).expect(200)).body;
    const u = new URL(start.url);
    expect(u.hostname).toBe('accounts.google.com'); expect(u.searchParams.get('code_challenge')).toBeTruthy(); expect(u.searchParams.get('access_type')).toBe('offline');
    const conn = (await request(http).get('/v1/oauth/google-sheets/callback').query({ code: 'gcode', state: stateOf(start.url) }).expect(200)).body.connection;
    expect(conn).toMatchObject({ provider: 'google-sheets', status: 'verified', name: 'Facebook sheet' });
    expect(conn.config).toMatchObject({ spreadsheetId: SID, spreadsheetTitle: 'Leads 2026', sheetName: 'Leads' });
    expect(JSON.stringify(conn)).not.toContain('g-refresh-token');

    const { TENANT_DB, KEY_SERVICE } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const { IntegrityService } = await import('@leaddesk/domain'); const { REGISTRY } = await import('../src/connections/connections.module');
    const db = app.get(TENANT_DB);
    const integ = new IntegrityService(db, app.get(KEY_SERVICE), app.get(REGISTRY));
    const first = await runWithTenant(o.tenantId, () => integ.backfill(conn.id, 14));
    expect(first).toEqual({ seen: 3, missing: 3, ingested: 3, failed: 0 });
    const names = (await request(http).get('/v1/leads').set(auth(o.token)).expect(200)).body.items.map((l: any) => l.displayName).sort();
    expect(names).toEqual(['Sheet Asha', 'Sheet Mina', 'Sheet Ravi']);
    const row = (await runWithTenant(o.tenantId, () => db.repos.connections.findById(conn.id))) as any;
    expect(row.config.backfillCursor).toBe(5);
    const second = await runWithTenant(o.tenantId, () => integ.backfill(conn.id, 14));
    expect(second).toEqual({ seen: 0, missing: 0, ingested: 0, failed: 0 }); // only rows after the cursor are read
    // a missing spreadsheet id is rejected up front
    const bad = (await request(http).get('/v1/oauth/google-sheets/start').set(auth(o.token)).expect(200)).body;
    await request(http).get('/v1/oauth/google-sheets/callback').query({ code: 'gcode', state: stateOf(bad.url) }).expect(422);
  });

  it('agents cannot start OAuth; unknown/non-OAuth providers are rejected', async () => {
    const o = await signup('oauth-perm');
    const inv = await request(http).post('/v1/invitations').set(auth(o.token)).send({ email: 'oauth-agent@x.io', role: 'agent' }).expect(201);
    const agent = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'A', password: 'agent-pass-123' }).expect(201)).body.accessToken;
    await request(http).get('/v1/oauth/meta-leadads/start').set(auth(agent)).expect(403);
    await request(http).get('/v1/oauth/website-webhook/start').set(auth(o.token)).expect(422);
    await request(http).get('/v1/oauth/nope/start').set(auth(o.token)).expect(422);
  });
});

describe('Do engine API (phase 3a)', () => {
  const iso = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  let owner: string; let agent: string; let agentId: string; let agent2: string; let leadId: string;
  beforeAll(async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'do-owner@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'Do Co', industryPreset: 'real_estate' }).expect(201);
    owner = o.body.accessToken;
    const mk = async (email: string) => {
      const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email, role: 'agent' }).expect(201);
      const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: email, password: 'agent-pass-123' }).expect(201);
      return { tok: r.body.accessToken as string, id: (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId as string };
    };
    ({ tok: agent, id: agentId } = await mk('do-a1@x.io')); ({ tok: agent2 } = await mk('do-a2@x.io'));
    leadId = (await request(http).post('/v1/leads').set(auth(agent)).send({ name: 'Do Lead', contacts: [{ value: '9876600001' }] }).expect(201)).body.leadId;
  });

  it('Today queue shows the new lead with a reason; no numbers leak; teammates see nothing', async () => {
    const q = (await request(http).get('/v1/do/queue').set(auth(agent)).expect(200)).body;
    expect(q.items[0]).toMatchObject({ kind: 'new_lead', leadName: 'Do Lead', suggestedAction: { type: 'call' } });
    expect(q.items[0].reason).toMatch(/New lead/);
    expect(JSON.stringify(q)).not.toContain('9876600001');
    expect((await request(http).get('/v1/do/queue').set(auth(agent2)).expect(200)).body).toMatchObject({ total: 0, caughtUp: true });
  });

  it('full loop: dial -> end -> outcome sheet enforces a concrete next action -> task -> queue updates', async () => {
    const call = (await request(http).post('/v1/calls').set(auth(agent)).send({ leadId }).expect(201)).body;
    expect(call.dialUri).toBe('tel:+919876600001');
    await request(http).post('/v1/calls').set(auth(agent)).send({ leadId }).expect(409).expect((r) => expect(r.body.code).toBe('outcome_pending'));
    const q1 = (await request(http).get('/v1/do/queue').set(auth(agent)).expect(200)).body;
    expect(q1.items[0].kind).toBe('outcome_pending');
    await request(http).post(`/v1/calls/${call.callSessionId}/end`).set(auth(agent)).send({ durationS: 95 }).expect(201);
    const outcomes = (await request(http).get('/v1/outcomes').set(auth(agent)).expect(200)).body;
    const interested = outcomes.find((o: any) => o.label === 'Connected - Interested');
    // vague / past / missing next action => 422 with field messages
    for (const next of [undefined, { dueAt: iso(60), contextNote: 'call' }, { dueAt: iso(-60), contextNote: 'Share brochure and confirm visit' }]) {
      const r = await request(http).post(`/v1/leads/${leadId}/outcome`).set(auth(agent)).send({ outcomeId: interested._id, callSessionId: call.callSessionId, next }).expect(422);
      expect(r.body.code).toBe('invalid_next_action'); expect(r.body.details).toBeTruthy();
    }
    const ok = (await request(http).post(`/v1/leads/${leadId}/outcome`).set(auth(agent)).send({ outcomeId: interested._id, callSessionId: call.callSessionId, durationS: 95, note: 'Wants 3BHK', next: { dueAt: iso(24 * 60), contextNote: 'Share brochure and confirm visit slot' } }).expect(201)).body;
    expect(ok.task.status).toBe('open'); expect(ok.suggestion.statusId).toBeTruthy();
    await request(http).post(`/v1/leads/${leadId}/outcome`).set(auth(agent)).send({ outcomeId: interested._id, callSessionId: call.callSessionId, next: { dueAt: iso(600), contextNote: 'Second logging should fail' } }).expect(422).expect((r) => expect(r.body.code).toBe('invalid_state'));
    const q2 = (await request(http).get('/v1/do/queue').set(auth(agent)).expect(200)).body;
    expect(q2.items.some((i: any) => i.kind === 'outcome_pending')).toBe(false);
    expect(q2.items.some((i: any) => i.kind === 'new_lead')).toBe(false); // first contact is logged
    const tasks = (await request(http).get('/v1/tasks').query({ status: 'open' }).set(auth(agent)).expect(200)).body;
    expect(tasks).toHaveLength(1); expect(tasks[0].contextNote).toBe('Share brochure and confirm visit slot');
    await request(http).post('/v1/calls').set(auth(agent)).send({ leadId }).expect(201); // free to dial again
  });

  it('tasks: create validates, reschedule/complete/cancel, ownership rules', async () => {
    const lead2 = (await request(http).post('/v1/leads').set(auth(agent)).send({ name: 'Task Lead', contacts: [{ value: '9876600002' }] }).expect(201)).body.leadId;
    await request(http).post('/v1/tasks').set(auth(agent)).send({ leadId: lead2, dueAt: iso(60), contextNote: 'vague' }).expect(422);
    await request(http).post('/v1/tasks').set(auth(agent)).send({ leadId: lead2, assigneeId: agentId, dueAt: iso(60), contextNote: 'Call regarding loan paperwork' }).expect(201);
    await request(http).post('/v1/tasks').set(auth(agent)).send({ leadId: lead2, assigneeId: '65f0000000000000000000aa', dueAt: iso(60), contextNote: 'Call regarding loan paperwork' }).expect(403);
    const mine = (await request(http).get('/v1/tasks').query({ leadId: lead2 }).set(auth(agent)).expect(200)).body;
    const t = mine[0];
    await request(http).patch(`/v1/tasks/${t._id}`).set(auth(agent2)).send({ action: 'complete' }).expect(403); // not theirs
    await request(http).patch(`/v1/tasks/${t._id}`).set(auth(agent)).send({ action: 'reschedule', dueAt: iso(-5) }).expect(422);
    const re = (await request(http).patch(`/v1/tasks/${t._id}`).set(auth(agent)).send({ action: 'reschedule', dueAt: iso(180), contextNote: 'Call regarding loan paperwork, evening' }).expect(200)).body;
    expect(re.status).toBe('open');
    expect((await request(http).patch(`/v1/tasks/${t._id}`).set(auth(owner)).send({ action: 'complete' }).expect(200)).body.status).toBe('done'); // manager+ may close anyone's
    await request(http).post('/v1/tasks').set(auth(agent2)).send({ leadId: lead2, dueAt: iso(60), contextNote: 'Call regarding loan paperwork' }).expect(403); // lead not visible to agent2
  });

  it("outcome skips are capped per day; other agents' leads/calls are off limits", async () => {
    const l = (await request(http).post('/v1/leads').set(auth(agent2)).send({ name: 'Skip Lead', contacts: [{ value: '9876600003' }] }).expect(201)).body.leadId;
    const c = (await request(http).post('/v1/calls').set(auth(agent2)).send({ leadId: l }).expect(201)).body;
    await request(http).post(`/v1/calls/${c.callSessionId}/end`).set(auth(agent)).send({}).expect(403);
    for (let i = 0; i < 3; i++) await request(http).post(`/v1/calls/${c.callSessionId}/skip-outcome`).set(auth(agent2)).expect(201);
    await request(http).post(`/v1/calls/${c.callSessionId}/skip-outcome`).set(auth(agent2)).expect(429);
    await request(http).post('/v1/calls').set(auth(agent)).send({ leadId: l }).expect(403); // not agent's lead
    await request(http).post(`/v1/leads/${l}/outcome`).set(auth(agent)).send({ outcomeId: '65f0000000000000000000bb' }).expect(403);
  });
});

describe('routing + SLA API (phase 3b)', () => {
  let owner: string; let tenantId: string;
  const agents: { tok: string; id: string }[] = [];
  const mk = async (email: string) => {
    const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email, role: 'agent' }).expect(201);
    const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: email, password: 'agent-pass-123' }).expect(201);
    const id = (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId as string;
    await request(http).put('/v1/me/presence').set(auth(r.body.accessToken)).send({ state: 'online' }).expect(200);
    return { tok: r.body.accessToken as string, id };
  };
  beforeAll(async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'route-owner@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'Route Co' }).expect(201);
    owner = o.body.accessToken; tenantId = o.body.tenantId;
    for (const n of [1, 2]) agents.push(await mk(`route-a${n}@x.io`));
  });

  it('configure rules + SLA (admin only, validated); leads auto-route with explanation; agent sees them; claim works', async () => {
    await request(http).put('/v1/rules/assignment').set(auth(agents[0].tok)).send({ rules: [] }).expect(403);
    await request(http).put('/v1/rules/assignment').set(auth(owner)).send({ rules: [{ name: 'bad', action: { kind: 'specific_user' } }] }).expect(422).expect((r) => expect(r.body.code).toBe('invalid_rule'));
    await request(http).put('/v1/rules/assignment').set(auth(owner)).send({ rules: [{ name: 'ghost', action: { kind: 'specific_user', userId: '65f0000000000000000000cc' } }] }).expect(422);
    const set = (await request(http).put('/v1/rules/assignment').set(auth(owner)).send({ rules: [{ name: 'Pune', conditions: { cities: ['Pune'], evil: 1 }, action: { kind: 'round_robin', poolUserIds: agents.map((a) => a.id), junk: true } }], default: { kind: 'round_robin', poolUserIds: [agents[1].id] } }).expect(200)).body;
    expect(set.rules[0].conditions).toEqual({ cities: ['Pune'] }); expect(set.rules[0].action.junk).toBeUndefined(); // unknown keys are dropped
    await request(http).put('/v1/sla').set(auth(owner)).send({ policies: [{ name: 'bad', claimSeconds: 5, firstContactSeconds: 100 }] }).expect(422);
    await request(http).put('/v1/sla').set(auth(owner)).send({ policies: [{ name: 'Default', claimSeconds: 120, firstContactSeconds: 900, maxReassignments: 1 }] }).expect(200);
    expect((await request(http).get('/v1/rules/assignment').set(auth(owner)).expect(200)).body.default).toMatchObject({ kind: 'round_robin' });

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await request(http).post('/v1/leads').set(auth(owner)).send({ name: `Routed ${i}`, city: 'Pune', contacts: [{ value: `98770000${i}1` }] }).expect(201)).body.leadId);
    const owners = await Promise.all(ids.map(async (id) => (await request(http).get(`/v1/leads/${id}`).set(auth(owner)).expect(200)).body.ownerId));
    expect(owners.filter((x) => x === agents[0].id)).toHaveLength(2); expect(owners.filter((x) => x === agents[1].id)).toHaveLength(2);
    const d = (await request(http).get(`/v1/leads/${ids[0]}/routing`).set(auth(owner)).expect(200)).body;
    expect(d[0].explanation).toMatch(/Rule "Pune" \(#1\) matched: city=Pune -> round-robin over 2/);
    const other = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'Elsewhere', city: 'Delhi', contacts: [{ value: '9877000099' }] }).expect(201)).body.leadId;
    expect((await request(http).get(`/v1/leads/${other}`).set(auth(owner)).expect(200)).body.ownerId).toBe(agents[1].id); // default pool

    // agent 0 sees their leads in Today with the SLA-aware reason, and can claim; the other agent cannot claim it
    const mine = ids.find((_, i) => owners[i] === agents[0].id)!;
    const q = (await request(http).get('/v1/do/queue').set(auth(agents[0].tok)).expect(200)).body;
    expect(q.items.every((i: any) => i.kind === 'new_lead')).toBe(true);
    await request(http).post(`/v1/leads/${mine}/claim`).set(auth(agents[1].tok)).expect(403);
    expect((await request(http).post(`/v1/leads/${mine}/claim`).set(auth(agents[0].tok)).expect(201)).body).toEqual({ ok: true, alreadyClaimed: false });
    await request(http).get(`/v1/leads/${mine}/routing`).set(auth(agents[1].tok)).expect(403); // not their lead
  });

  it('SLA sweeper reassigns an unclaimed lead and notifies; presence endpoint is validated and team view is manager-only', async () => {
    const { TENANT_DB, SYSTEM_OPS } = await import('@leaddesk/platform'); const { SlaService } = await import('@leaddesk/domain'); const { runWithTenant } = await import('@leaddesk/db');
    const db = app.get(TENANT_DB); const sys = app.get(SYSTEM_OPS);
    const id = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'Unclaimed', city: 'Pune', contacts: [{ value: '9877000077' }] }).expect(201)).body.leadId;
    const before = (await request(http).get(`/v1/leads/${id}`).set(auth(owner)).expect(200)).body.ownerId;
    await new SlaService(db, () => new Date(Date.now() + 10 * 60_000)).sweepAll(sys);
    const after = (await request(http).get(`/v1/leads/${id}`).set(auth(owner)).expect(200)).body.ownerId;
    expect(after).not.toBe(before);
    const decisions = (await request(http).get(`/v1/leads/${id}/routing`).set(auth(owner)).expect(200)).body;
    expect(decisions[0].reason).toBe('sla_claim');
    const notes = (await request(http).get('/v1/notifications').set(auth(agents.find((a) => a.id === before)!.tok)).expect(200)).body;
    expect(notes.map((n: any) => n.kind)).toContain('sla.breached');
    void runWithTenant; void tenantId;

    await request(http).put('/v1/me/presence').set(auth(agents[0].tok)).send({ state: 'on_call' }).expect(400); // system-controlled
    await request(http).put('/v1/me/presence').set(auth(agents[0].tok)).send({ state: 'away' }).expect(200);
    await request(http).get('/v1/team/presence').set(auth(agents[0].tok)).expect(403);
    const team = (await request(http).get('/v1/team/presence').set(auth(owner)).expect(200)).body;
    expect(team.find((t: any) => t.userId === agents[0].id).state).toBe('away');
  });

  it('profile (routing inputs) can be edited by admins only and affects routing', async () => {
    await request(http).patch(`/v1/users/${agents[1].id}/profile`).set(auth(agents[0].tok)).send({ skills: ['x'] }).expect(403);
    await request(http).patch(`/v1/users/${agents[1].id}/profile`).set(auth(owner)).send({ maxOpenLeads: 0 }).expect(400);
    await request(http).patch(`/v1/users/${agents[1].id}/profile`).set(auth(owner)).send({ languages: ['Hindi'], skills: ['premium'], onLeaveUntil: new Date(Date.now() + 86400_000).toISOString() }).expect(200);
    await request(http).put('/v1/rules/assignment').set(auth(owner)).send({ rules: [{ name: 'All', action: { kind: 'round_robin', poolUserIds: agents.map((a) => a.id) } }] }).expect(200);
    for (let i = 0; i < 3; i++) {
      const id = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: `Leave ${i}`, contacts: [{ value: `98770011${i}1` }] }).expect(201)).body.leadId;
      expect((await request(http).get(`/v1/leads/${id}`).set(auth(owner)).expect(200)).body.ownerId).not.toBe(agents[1].id); // on leave
    }
    await request(http).patch('/v1/users/65f0000000000000000000dd/profile').set(auth(owner)).send({ skills: [] }).expect(404);
  });
});

describe('realtime SSE stream (phase 3c)', () => {
  interface Sse { events: { id?: string; type: string; data: any }[]; close: () => void; status: number; wait: (type: string, pred?: (d: any) => boolean, ms?: number) => Promise<any> }
  let port: number;
  const openStream = (token: string | null, lastEventId?: string) => new Promise<Sse>((resolve, reject) => {
    const events: Sse['events'] = [];
    const req = nodeHttp.request({ host: '127.0.0.1', port, path: '/v1/stream', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}), Accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev: any = { type: 'message', data: undefined };
          for (const line of block.split('\n')) { if (line.startsWith('id:')) ev.id = line.slice(3).trim(); else if (line.startsWith('event:')) ev.type = line.slice(6).trim(); else if (line.startsWith('data:')) { try { ev.data = JSON.parse(line.slice(5)); } catch { ev.data = line.slice(5); } } }
          events.push(ev);
        }
      });
      resolve({ events, status: res.statusCode ?? 0, close: () => { req.destroy(); res.destroy(); },
        wait: async (type, pred = () => true, ms = 4000) => { const t0 = Date.now(); for (;;) { const f = events.find((e) => e.type === type && pred(e.data)); if (f) return f; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${type}; got ${events.map((e) => e.type).join(',')}`); await new Promise((r) => setTimeout(r, 25)); } } });
    });
    req.on('error', (e) => { if ((e as any).code !== 'ECONNRESET') reject(e); });
    req.end();
  });
  const open: Sse[] = [];
  const stream = async (token: string | null, last?: string) => { const s = await openStream(token, last); open.push(s); return s; };
  let owner: string; let tenantId: string; const ag: { tok: string; id: string }[] = [];

  beforeAll(async () => {
    const server = await app.listen(0); port = (server.address() as any).port;
    const o = await request(http).post('/v1/auth/signup').send({ email: 'rt-owner@x.io', password: 'correct-horse-9', name: 'O', tenantName: 'RT Co' }).expect(201);
    owner = o.body.accessToken; tenantId = o.body.tenantId;
    for (const n of [1, 2]) {
      const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email: `rt-a${n}@x.io`, role: 'agent' }).expect(201);
      const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: `a${n}`, password: 'agent-pass-123' }).expect(201);
      ag.push({ tok: r.body.accessToken, id: (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId });
      await request(http).put('/v1/me/presence').set(auth(r.body.accessToken)).send({ state: 'online' }).expect(200);
    }
    await request(http).put('/v1/rules/assignment').set(auth(owner)).send({ rules: [{ name: 'a1 only', action: { kind: 'specific_user', userId: ag[0].id } }] }).expect(200);
    await request(http).put('/v1/sla').set(auth(owner)).send({ policies: [{ name: 'D', claimSeconds: 120, firstContactSeconds: 900 }] }).expect(200);
  });
  afterAll(() => { open.forEach((s) => s.close()); });

  it('requires authentication', async () => {
    const s = await openStream(null); expect(s.status).toBe(401); s.close();
  });

  it('delivers lead.assigned (with claim timer) only to the assignee; no contact details leak; teammates and the admin do not get it', async () => {
    const a1 = await stream(ag[0].tok); const a2 = await stream(ag[1].tok); const adm = await stream(owner);
    expect(a1.status).toBe(200);
    await a1.wait('ready');
    const id = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'Live Lead', contacts: [{ value: '9855500001' }] }).expect(201)).body.leadId;
    const ev = await a1.wait('lead.assigned', (d) => d.leadId === id);
    expect(ev.data.claimDueAt).toBeTruthy();
    expect(JSON.stringify(a1.events)).not.toContain('9855500001');
    await new Promise((r) => setTimeout(r, 400));
    expect(a2.events.some((e) => e.type === 'lead.assigned')).toBe(false);
    expect(adm.events.some((e) => e.type === 'lead.assigned')).toBe(false);
    a1.close(); a2.close(); adm.close();
  });

  it('task.created reaches the assignee; task.due fires when it becomes due; managers get missed/escalated', async () => {
    const a1 = await stream(ag[0].tok); const adm = await stream(owner); await a1.wait('ready'); await adm.wait('ready');
    const lead = (await request(http).post('/v1/leads').set(auth(ag[0].tok)).send({ name: 'Due Lead', contacts: [{ value: '9855500002' }] }).expect(201)).body.leadId;
    const t = (await request(http).post('/v1/tasks').set(auth(ag[0].tok)).send({ leadId: lead, dueAt: new Date(Date.now() + 3600_000).toISOString(), contextNote: 'Call about the documents' }).expect(201)).body;
    await a1.wait('task.created', (d) => d.taskId === t._id);
    // a task whose due time passes while connected
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const db = app.get(TENANT_DB);
    const soon: any = await runWithTenant(tenantId, () => db.repos.tasks.create({ leadId: lead, assigneeId: ag[0].id, dueAt: new Date(Date.now() + 600), contextNote: 'Due very soon task', status: 'open' }));
    await a1.wait('task.due', (d) => d.taskId === String(soon._id));
    // missed/escalated go to managers+, not to the plain agent
    await runWithTenant(tenantId, async () => { await db.repos.outbox.add('task.escalated', 'x1', {}); await db.repos.outbox.add('task.missed', 'x2', { assigneeId: ag[1].id, leadId: lead }); });
    await adm.wait('task.escalated'); await adm.wait('task.missed');
    await new Promise((r) => setTimeout(r, 300));
    expect(a1.events.some((e) => e.type === 'task.escalated' || (e.type === 'task.missed' && e.data.taskId === 'x2'))).toBe(false);
    a1.close(); adm.close();
  });

  it('connection alerts (notifications) go to admins only', async () => {
    const { TENANT_DB } = await import('@leaddesk/platform'); const { DbNotifier } = await import('@leaddesk/domain'); const { runWithTenant } = await import('@leaddesk/db');
    const db = app.get(TENANT_DB);
    const a1 = await stream(ag[0].tok); const adm = await stream(owner); await a1.wait('ready'); await adm.wait('ready');
    await runWithTenant(tenantId, () => new DbNotifier(db).notify({ kind: 'connection.degraded', audience: 'admins', payload: { name: 'Meta', reconnectPath: '/v1/connections/x/reconnect' }, dedupeKey: `rt-${Date.now()}` }));
    const ev = await adm.wait('connection.degraded');
    expect(ev.data.reconnectPath).toBe('/v1/connections/x/reconnect');
    await new Promise((r) => setTimeout(r, 300));
    expect(a1.events.some((e) => e.type === 'connection.degraded')).toBe(false);
    a1.close(); adm.close();
  });

  it('never leaks across tenants', async () => {
    const other = await signup('rt-other');
    const mine = await stream(other.token); await mine.wait('ready');
    await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'Not yours', contacts: [{ value: '9855500003' }] }).expect(201);
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    await runWithTenant(tenantId, () => app.get(TENANT_DB).repos.outbox.add('task.escalated', 'leak', {}));
    await new Promise((r) => setTimeout(r, 500));
    expect(mine.events.filter((e) => e.type !== 'ready')).toHaveLength(0);
    mine.close();
  });

  it('reconnecting with Last-Event-ID replays what was missed; the per-user stream cap is enforced', async () => {
    const first = await stream(ag[0].tok); await first.wait('ready');
    const l1 = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'Before', contacts: [{ value: '9855500004' }] }).expect(201)).body.leadId;
    const seen = await first.wait('lead.assigned', (d) => d.leadId === l1);
    first.close();
    await new Promise((r) => setTimeout(r, 200));
    const l2 = (await request(http).post('/v1/leads').set(auth(owner)).send({ name: 'While away', contacts: [{ value: '9855500005' }] }).expect(201)).body.leadId; // arrives while disconnected
    await new Promise((r) => setTimeout(r, 300));
    const back = await stream(ag[0].tok, seen.id);
    await back.wait('lead.assigned', (d) => d.leadId === l2);
    expect(back.events.some((e) => e.type === 'lead.assigned' && e.data.leadId === l1)).toBe(false); // nothing is replayed twice
    back.close();
    const many: Sse[] = [];
    for (let i = 0; i < 5; i++) many.push(await stream(ag[1].tok));
    const sixth = await openStream(ag[1].tok); open.push(sixth);
    await new Promise((r) => setTimeout(r, 300));
    expect(sixth.events.some((e) => e.type === 'ready')).toBe(false);
    many.forEach((m) => m.close()); sixth.close();
  });
});

describe('messaging API (phase 4a, fixtures for WhatsApp Cloud + MSG91)', () => {
  const WABA = '1234567890'; const PHONE_ID = '9876543210';
  const wa = { subscribed: false, sends: [] as any[], templates: [] as any[] };
  const sms = { sends: [] as any[] };
  const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  const fx = async (url: string, init?: any) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/v26\.0\//, '');
    if (u.hostname === 'control.msg91.com') { sms.sends.push(JSON.parse(init.body)); return resp(200, { type: 'success', message: `msg91-req-${sms.sends.length}` }); }
    if (u.hostname !== 'graph.facebook.com') return resp(404, {});
    if (path === 'oauth/access_token') return resp(200, { access_token: 'wa-business-token' });
    if (path === PHONE_ID && !init?.method) return resp(200, { id: PHONE_ID, display_phone_number: '+91 98000 11111', verified_name: 'Acme Realty', quality_rating: 'GREEN' });
    if (path === WABA) return resp(200, { name: 'Acme WABA' });
    if (path === `${WABA}/subscribed_apps`) { if (init?.method === 'POST') { wa.subscribed = true; return resp(200, { success: true }); } return resp(200, { data: wa.subscribed ? [{ id: 'APP1' }] : [] }); }
    if (path === `${PHONE_ID}/messages`) { wa.sends.push(JSON.parse(init.body)); return resp(200, { messages: [{ id: `wamid.OUT${wa.sends.length}` }] }); }
    if (path.startsWith(`${WABA}/message_templates`)) {
      if (init?.method === 'POST') { const b = JSON.parse(init.body); wa.templates.push(b); return resp(200, { id: `prov-${b.name}`, status: 'PENDING' }); }
      return resp(200, { data: wa.templates.map((t) => ({ id: `prov-${t.name}`, name: t.name, language: t.language, status: 'APPROVED', category: t.category, components: t.components })) });
    }
    return resp(404, { error: { code: 100, message: `unmocked ${path}` } });
  };
  let owner: string; let tenantId: string; let agent: { tok: string; id: string }; let other: { tok: string; id: string };
  let waConn: string; let leadId: string; let convId: string;
  const inboxRow = async (payload: any, eventId: string) => {
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const row: any = await runWithTenant(tenantId, () => app.get(TENANT_DB).repos.inbox.create({ connectionId: waConn, provider: 'whatsapp-cloud', externalEventId: eventId, rawPayload: payload, signatureValid: true, status: 'received' }));
    return (await request(http).post(`/v1/inbox/${row._id}/replay`).set(auth(owner)).expect(201)).body;
  };

  beforeAll(async () => {
    providerFetch = fx;
    const o = await request(http).post('/v1/auth/signup').send({ email: 'msg-owner@x.io', password: 'correct-horse-9', name: 'Olivia', tenantName: 'Msg Co' }).expect(201);
    owner = o.body.accessToken; tenantId = o.body.tenantId;
    const mk = async (email: string) => {
      const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email, role: 'agent' }).expect(201);
      const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Asha Agent', password: 'agent-pass-123' }).expect(201);
      return { tok: r.body.accessToken as string, id: (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId as string };
    };
    agent = await mk('msg-a1@x.io'); other = await mk('msg-a2@x.io');
    leadId = (await request(http).post('/v1/leads').set(auth(agent.tok)).send({ name: 'Anita Desai', contacts: [{ value: '9812345678' }] }).expect(201)).body.leadId;
  });

  it('no channel connected: buttons hidden, sends refused, fallback links work and are labelled self-reported', async () => {
    expect((await request(http).get('/v1/channels').set(auth(agent.tok)).expect(200)).body).toMatchObject({ whatsapp: { connected: false }, sms: { connected: false } });
    await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'key-00000001').send({ leadId, channel: 'whatsapp', body: 'hi' }).expect(409).expect((r) => expect(r.body.code).toBe('channel_not_connected'));
    const l = (await request(http).post('/v1/messages/launch').set(auth(agent.tok)).send({ leadId, channel: 'whatsapp', body: 'Hello Anita & welcome' }).expect(201)).body;
    expect(l).toMatchObject({ selfReported: true }); expect(l.url).toBe('https://wa.me/919812345678?text=Hello%20Anita%20%26%20welcome');
    expect((await request(http).post('/v1/messages/launch').set(auth(agent.tok)).send({ leadId, channel: 'sms' }).expect(201)).body.url).toBe('sms:+919812345678');
    const tl = (await request(http).get(`/v1/leads/${leadId}/timeline`).set(auth(agent.tok)).expect(200)).body.items;
    expect(tl.filter((a: any) => a.type === 'message_out' && a.payload.selfReported)).toHaveLength(2);
    await request(http).post('/v1/messages/launch').set(auth(other.tok)).send({ leadId, channel: 'sms' }).expect(403); // not their lead
  });

  it('WhatsApp Embedded Signup connects a number, subscribes the app and exposes the channel', async () => {
    await request(http).post('/v1/oauth/whatsapp/embedded-signup').set(auth(agent.tok)).send({ code: 'authcode1', wabaId: WABA, phoneNumberId: PHONE_ID }).expect(403);
    await request(http).post('/v1/oauth/whatsapp/embedded-signup').set(auth(owner)).send({ code: 'x', wabaId: 'abc', phoneNumberId: PHONE_ID }).expect(400); // validated ids
    const r = (await request(http).post('/v1/oauth/whatsapp/embedded-signup').set(auth(owner)).send({ code: 'authcode1', wabaId: WABA, phoneNumberId: PHONE_ID, name: 'Main WhatsApp' }).expect(201)).body;
    waConn = r.connection.id;
    expect(r.connection).toMatchObject({ provider: 'whatsapp-cloud', status: 'verified', config: { wabaId: WABA, phoneNumberId: PHONE_ID, displayPhone: '+91 98000 11111' } });
    expect(JSON.stringify(r)).not.toContain('wa-business-token');
    expect(r.resubscribed).toBe(true); expect(wa.subscribed).toBe(true);
    expect((await request(http).get('/v1/channels').set(auth(agent.tok)).expect(200)).body.whatsapp.connected).toBe(true);
    await request(http).post('/v1/messages/launch').set(auth(agent.tok)).send({ leadId, channel: 'whatsapp' }).expect(409); // connected: use the platform
  });

  it('inbound WhatsApp message opens the window; free text then sends once per Idempotency-Key; thread and unread work', async () => {
    const out = await inboxRow({ kind: 'message', phone_number_id: PHONE_ID, from: '919812345678', id: 'wamid.IN1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Is the 3BHK still available?' }, profileName: 'Anita Desai' }, 'wamid.IN1');
    expect(out.status).toBe('done');
    const convs = (await request(http).get('/v1/conversations').query({ leadId }).set(auth(agent.tok)).expect(200)).body;
    expect(convs).toHaveLength(1); expect(convs[0]).toMatchObject({ channel: 'whatsapp', unreadCount: 1 }); convId = convs[0]._id;
    await request(http).get(`/v1/conversations/${convId}/messages`).set(auth(other.tok)).expect(403);
    const thread = (await request(http).get(`/v1/conversations/${convId}/messages`).set(auth(agent.tok)).expect(200)).body;
    expect(thread.items.map((m: any) => [m.direction, m.body])).toEqual([['in', 'Is the 3BHK still available?']]);

    await request(http).post('/v1/messages').set(auth(agent.tok)).send({ leadId, channel: 'whatsapp', body: 'yes' }).expect(400); // Idempotency-Key required
    const send = () => request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'tap-0000-0001').send({ leadId, channel: 'whatsapp', body: 'Yes, it is. Can I call you at 6 PM?' });
    const m1 = (await send().expect(201)).body; const m2 = (await send().expect(201)).body;
    expect(m1.message.status).toBe('sent'); expect(m2.duplicate).toBe(true); expect(m2.message._id).toBe(m1.message._id);
    expect(wa.sends).toHaveLength(1);
    expect(wa.sends[0]).toMatchObject({ to: '919812345678', type: 'text', text: { body: 'Yes, it is. Can I call you at 6 PM?' } });
    await request(http).post(`/v1/conversations/${convId}/read`).set(auth(agent.tok)).expect(201);
    expect((await request(http).get('/v1/conversations').query({ leadId }).set(auth(agent.tok)).expect(200)).body[0].unreadCount).toBe(0);
  });

  it('delivery status webhooks advance the message; STOP opts the lead out and blocks sends', async () => {
    await inboxRow({ kind: 'status', phone_number_id: PHONE_ID, id: 'wamid.OUT1', status: 'delivered', recipient_id: '919812345678' }, 'status:wamid.OUT1:delivered');
    await inboxRow({ kind: 'status', phone_number_id: PHONE_ID, id: 'wamid.OUT1', status: 'read', recipient_id: '919812345678' }, 'status:wamid.OUT1:read');
    const items = (await request(http).get(`/v1/conversations/${convId}/messages`).set(auth(agent.tok)).expect(200)).body.items;
    expect(items.find((m: any) => m.direction === 'out').status).toBe('read');
    await inboxRow({ kind: 'message', phone_number_id: PHONE_ID, from: '919812345678', id: 'wamid.IN2', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Stop' } }, 'wamid.IN2');
    await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'after-stop-001').send({ leadId, channel: 'whatsapp', body: 'ping' }).expect(409).expect((r) => expect(r.body.code).toBe('opted_out'));
    expect(wa.sends).toHaveLength(1);
    const lead = (await request(http).get(`/v1/leads/${leadId}`).set(auth(agent.tok)).expect(200)).body;
    expect(JSON.stringify(lead)).not.toContain('9812345678'); // custody still holds
  });

  it('templates: admin-only create, submit to Meta, sync approves, then a template send goes out with rendered variables', async () => {
    await request(http).post('/v1/templates').set(auth(agent.tok)).send({ channel: 'whatsapp', name: 'x', body: 'y' }).expect(403);
    await request(http).post('/v1/templates').set(auth(owner)).send({ channel: 'whatsapp', name: 'Bad Name', body: 'x' }).expect(422);
    const t = (await request(http).post('/v1/templates').set(auth(owner)).send({ channel: 'whatsapp', name: 'site_visit', body: 'Hi {{1}}, this is {{2}} from {{3}}. Shall we book your site visit?', variables: ['first_name', 'agent_name', 'company'], category: 'utility' }).expect(201)).body;
    expect(t.status).toBe('draft');
    expect((await request(http).post(`/v1/templates/${t._id}/submit`).set(auth(owner)).expect(201)).body).toMatchObject({ status: 'pending', providerTemplateId: 'prov-site_visit' });
    expect(wa.templates[0]).toMatchObject({ name: 'site_visit', category: 'UTILITY', components: [{ type: 'BODY', example: { body_text: [['Asha', 'Ravi', 'Acme']] } }] });
    expect((await request(http).post('/v1/templates/sync').set(auth(owner)).expect(201)).body).toEqual({ updated: 1, imported: 0 });
    expect((await request(http).get('/v1/templates').query({ status: 'approved' }).set(auth(agent.tok)).expect(200)).body.map((x: any) => x.name)).toEqual(['site_visit']);
    // a different lead that has not opted out; the template works outside the 24h window
    const l2 = (await request(http).post('/v1/leads').set(auth(agent.tok)).send({ name: 'Rohan Mehta', contacts: [{ value: '9812300000' }] }).expect(201)).body.leadId;
    const r = (await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'tpl-send-0001').send({ leadId: l2, channel: 'whatsapp', templateId: t._id }).expect(201)).body;
    expect(r.message.body).toBe('Hi Rohan, this is Asha Agent from Msg Co. Shall we book your site visit?');
    expect(wa.sends.at(-1).template).toEqual({ name: 'site_visit', language: { code: 'en' }, components: [{ type: 'body', parameters: ['Rohan', 'Asha Agent', 'Msg Co'].map((text) => ({ type: 'text', text })) }] });
    await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'tpl-send-0002').send({ leadId: l2, channel: 'whatsapp', body: 'free text outside window' }).expect(409).expect((x) => expect(x.body.code).toBe('window_closed'));
  });

  it('SMS (MSG91): creating the connection reveals the webhook token once; DLT approval gates sending', async () => {
    const c = (await request(http).post('/v1/connections').set(auth(owner)).send({ provider: 'sms-msg91', name: 'MSG91', credentials: { authKey: 'AUTHKEY1234567890ab' }, config: { senderId: 'ACMEIN', dltEntityId: '1101234567890' } }).expect(201)).body;
    expect(c.connection.status).toBe('verified'); expect(c.revealedOnce.webhookToken).toHaveLength(43);
    expect(c.connection.webhookPath).toMatch(/^\/hooks\/sms-msg91\//);
    const lead2 = (await request(http).get('/v1/leads').query({ q: 'Rohan' }).set(auth(agent.tok)).expect(200)).body.items[0]._id;
    await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'sms-free-0001').send({ leadId: lead2, channel: 'sms', body: 'free text' }).expect(409).expect((r) => expect(r.body.code).toBe('dlt_template_required'));
    const t = (await request(http).post('/v1/templates').set(auth(owner)).send({ channel: 'sms', name: 'visit_confirm', body: 'Hi {{1}}, your site visit is confirmed. -ACME', variables: ['first_name'] }).expect(201)).body;
    await request(http).post(`/v1/templates/${t._id}/approve`).set(auth(owner)).expect(422).expect((r) => expect(r.body.code).toBe('dlt_incomplete'));
    await request(http).put(`/v1/templates/${t._id}`).set(auth(owner)).send({ dltTemplateId: '1107161234567890', providerTemplateId: 'flow-abc', dltHeader: 'ACMEIN' }).expect(200);
    expect((await request(http).post(`/v1/templates/${t._id}/approve`).set(auth(owner)).expect(201)).body.status).toBe('approved');
    const r = (await request(http).post('/v1/messages').set(auth(agent.tok)).set('Idempotency-Key', 'sms-tpl-00001').send({ leadId: lead2, channel: 'sms', templateId: t._id }).expect(201)).body;
    expect(r.message.status).toBe('sent');
    expect(sms.sends[0]).toEqual({ template_id: 'flow-abc', short_url: '0', recipients: [{ mobiles: '919812300000', VAR1: 'Rohan' }] });
    expect((await request(http).get('/v1/channels').set(auth(agent.tok)).expect(200)).body.sms.connected).toBe(true);
  });

  it('other tenants see none of it', async () => {
    const o2 = await signup('msg-other');
    expect((await request(http).get('/v1/channels').set(auth(o2.token)).expect(200)).body).toMatchObject({ whatsapp: { connected: false }, sms: { connected: false } });
    expect((await request(http).get('/v1/templates').set(auth(o2.token)).expect(200)).body).toHaveLength(0);
    await request(http).get(`/v1/conversations/${convId}/messages`).set(auth(o2.token)).expect(404);
    await request(http).post('/v1/messages').set(auth(o2.token)).set('Idempotency-Key', 'cross-0000001').send({ leadId, channel: 'whatsapp', body: 'x' }).expect(404);
  });
});

describe('telephony API (phase 4b, Exotel documented-shape fixtures)', () => {
  const ex = { calls: [] as any[], recordingFetches: 0 };
  const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  const fx = async (url: string, init?: any) => {
    const u = new URL(url);
    if (u.hostname === 'api.exotel.com' && u.pathname.endsWith('/Calls/connect.json')) { ex.calls.push(Object.fromEntries(new URLSearchParams(init.body))); return resp(200, { Call: { Sid: `sid-${ex.calls.length}`, Status: 'queued' } }); }
    if (u.hostname === 'api.exotel.com') return resp(200, {});
    if (u.hostname === 'recordings.exotel.com') { ex.recordingFetches++; return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new TextEncoder().encode('FAKE-MP3-BYTES').buffer, headers: { get: () => 'audio/mpeg' } }; }
    return resp(404, {});
  };
  let owner: string; let tenantId: string; let agent: { tok: string; id: string }; let leadId: string; let connId: string;
  const openSse = async (token: string) => {
    if (!(http.address && http.address())) await app.listen(0);
    const port = (http.address() as any).port;
    const events: { type: string; data: any }[] = [];
    let req!: nodeHttp.ClientRequest;
    await new Promise<void>((resolve, reject) => {
      req = nodeHttp.request({ host: '127.0.0.1', port, path: '/v1/stream', headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } }, (res) => {
        let buf = ''; res.setEncoding('utf8');
        res.on('data', (c: string) => { buf += c; for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev: any = { type: 'message' }; for (const l of blk.split('\n')) { if (l.startsWith('event:')) ev.type = l.slice(6).trim(); else if (l.startsWith('data:')) { try { ev.data = JSON.parse(l.slice(5)); } catch { /* keep-alive */ } } } events.push(ev); } });
        resolve();
      });
      req.on('error', (e) => { if ((e as any).code !== 'ECONNRESET') reject(e); });
      req.end();
    });
    return { close: () => req.destroy(), waitFor: async (type: string, ms = 4000) => { const t0 = Date.now(); for (;;) { const f = events.find((e) => e.type === type); if (f) return f; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${type}; got ${events.map((e) => e.type).join(',')}`); await new Promise((r) => setTimeout(r, 25)); } } };
  };
  const hook = async (body: Record<string, string>) => {
    // what the ingress does: verify, store raw (form decoded to a map), then the worker/replay processes it
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const row: any = await runWithTenant(tenantId, () => app.get(TENANT_DB).repos.inbox.create({ connectionId: connId, provider: 'telephony-exotel', externalEventId: `${body.CallSid}:${body.Status}${body.RecordingUrl ? ':rec' : ''}${body.Extra ? ':' + body.Extra : ''}`, rawPayload: body, signatureValid: true, status: 'received' }));
    return (await request(http).post(`/v1/inbox/${row._id}/replay`).set(auth(owner)).expect(201)).body;
  };

  beforeAll(async () => {
    providerFetch = fx;
    const o = await request(http).post('/v1/auth/signup').send({ email: 'tel-owner@x.io', password: 'correct-horse-9', name: 'Tess', tenantName: 'Tel Co' }).expect(201);
    owner = o.body.accessToken; tenantId = o.body.tenantId;
    const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email: 'tel-a1@x.io', role: 'agent' }).expect(201);
    const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'Asha', password: 'agent-pass-123' }).expect(201);
    agent = { tok: r.body.accessToken, id: (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId };
    leadId = (await request(http).post('/v1/leads').set(auth(agent.tok)).send({ name: 'Vikram', contacts: [{ value: '9812399999' }] }).expect(201)).body.leadId;
  });

  it('without a voice connection the call falls back to tap-to-call (self-reported)', async () => {
    const d = (await request(http).post('/v1/calls').set(auth(agent.tok)).send({ leadId }).expect(201)).body;
    expect(d.mode).toBe('tap'); expect(d.dialUri).toMatch(/^tel:/);
    const oc = (await request(http).get('/v1/outcomes').set(auth(agent.tok)).expect(200)).body;
    await request(http).post(`/v1/leads/${leadId}/outcome`).set(auth(agent.tok)).send({ outcomeId: oc[0]._id, callSessionId: d.callSessionId, durationS: 3, next: { dueAt: new Date(Date.now() + 86400e3).toISOString(), contextNote: 'Retry the call tomorrow morning' } }).expect(201);
  });

  it('cloud mode: platform rings the agent, number never exposed, system-verified duration, recording behind permission + signed URL', async () => {
    const c = (await request(http).post('/v1/connections').set(auth(owner)).send({ provider: 'telephony-exotel', name: 'Exotel', credentials: { apiKey: 'k', apiToken: 't' }, config: { accountSid: 'acme1', callerId: '+918000000000', agentNumbers: JSON.stringify({ [agent.id]: '+919900000001' }) } }).expect(201)).body;
    connId = c.connection.id;
    expect(c.connection.status).toBe('verified');

    const stream = await openSse(agent.tok);
    const d = (await request(http).post('/v1/calls').set(auth(agent.tok)).send({ leadId }).expect(201)).body;
    expect(d.mode).toBe('cloud'); expect(JSON.stringify(d)).not.toContain('9812399999');
    expect(ex.calls[0]).toMatchObject({ From: '+919900000001', To: '+919812399999', CallerId: '+918000000000', Record: 'true' });
    expect(ex.calls[0].StatusCallback).toMatch(/^https:\/\/hooks\.example\.test\/hooks\/telephony-exotel\/.+\?token=/);
    // a second dial while the first awaits its outcome is refused
    await request(http).post('/v1/calls').set(auth(agent.tok)).send({ leadId }).expect(409).expect((r) => expect(r.body.code).toBe('outcome_pending'));

    await hook({ CallSid: 'sid-1', Status: 'in-progress' });
    await hook({ CallSid: 'sid-1', Status: 'completed', ConversationDuration: '125' });
    const dup = await hook({ CallSid: 'sid-1', Status: 'completed', ConversationDuration: '125', Extra: '1' }); // a re-delivered callback (different bytes) is harmless
    expect(dup.status).toBe('done');
    const ev = await stream.waitFor('call.ended');
    expect(ev.data).toMatchObject({ callSessionId: d.callSessionId, leadId, durationS: 125 });
    stream.close();

    await hook({ CallSid: 'sid-1', Status: 'completed', RecordingUrl: 'https://recordings.exotel.com/acme1/rec1.mp3' });
    expect(ex.recordingFetches).toBe(1);
    const calls = (await request(http).get('/v1/calls').query({ leadId }).set(auth(agent.tok)).expect(200)).body;
    expect(calls[0]).toMatchObject({ mode: 'cloud', state: 'ended', durationS: 125, durationSource: 'system' });
    expect(JSON.stringify(calls)).not.toMatch(/recordingObjectKey|recordings\//);

    await request(http).get(`/v1/calls/${d.callSessionId}/recording`).set(auth(agent.tok)).expect(403); // agents cannot listen
    const rec = (await request(http).get(`/v1/calls/${d.callSessionId}/recording`).set(auth(owner)).expect(200)).body;
    expect(rec.url).toMatch(/\/v1\/recordings\//);
    const audio = await request(http).get(new URL(rec.url).pathname).expect(200); // token is the credential
    expect(audio.headers['content-type']).toContain('audio/mpeg');
    await request(http).get(new URL(rec.url).pathname + 'x').expect(404); // tampered
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    expect(await runWithTenant(tenantId, () => app.get(TENANT_DB).repos.audit.find({ action: 'recording.accessed' }))).toHaveLength(1); // only the manager's access, not the refused agent

    // outcome after the system-verified call keeps the system duration
    const outcomes = (await request(http).get('/v1/outcomes').set(auth(agent.tok)).expect(200)).body;
    const connected = outcomes.find((x: any) => x.key === 'connected' || x.connected) ?? outcomes[0];
    await request(http).post(`/v1/leads/${leadId}/outcome`).set(auth(agent.tok)).send({ outcomeId: connected._id, callSessionId: d.callSessionId, durationS: 5, next: { dueAt: new Date(Date.now() + 86400e3).toISOString(), contextNote: 'Send brochure and confirm visit slot' } }).expect(201);
  });

  it('a failed provider call frees the agent; other tenants cannot reach recordings or calls', async () => {
    providerFetch = async (u, i) => (new URL(u).pathname.endsWith('/Calls/connect.json') ? resp(500, {}) : fx(u, i));
    await request(http).post('/v1/calls').set(auth(agent.tok)).send({ leadId }).expect(502);
    providerFetch = fx;
    await request(http).post('/v1/calls').set(auth(agent.tok)).send({ leadId }).expect(201); // not blocked by the failed attempt
    const o2 = await signup('tel-other');
    await request(http).get('/v1/calls').query({ leadId }).set(auth(o2.token)).expect(404);
  });
});

describe('cadences + first-touch API, message.in realtime (phase 4c)', () => {
  let owner: string; let tenantId: string; let agent: { tok: string; id: string }; let other: { tok: string; id: string }; let leadId: string;
  const openSse = async (token: string) => {
    if (!(http.address && http.address())) await app.listen(0);
    const port = (http.address() as any).port; const events: { type: string; data: any }[] = []; let req!: nodeHttp.ClientRequest;
    await new Promise<void>((resolve, reject) => {
      req = nodeHttp.request({ host: '127.0.0.1', port, path: '/v1/stream', headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' } }, (res) => {
        let buf = ''; res.setEncoding('utf8');
        res.on('data', (c: string) => { buf += c; for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) { const blk = buf.slice(0, i); buf = buf.slice(i + 2); const ev: any = { type: 'message' }; for (const l of blk.split('\n')) { if (l.startsWith('event:')) ev.type = l.slice(6).trim(); else if (l.startsWith('data:')) { try { ev.data = JSON.parse(l.slice(5)); } catch { /* ping */ } } } events.push(ev); } });
        resolve();
      });
      req.on('error', (e) => { if ((e as any).code !== 'ECONNRESET') reject(e); }); req.end();
    });
    return { events, close: () => req.destroy(), waitFor: async (type: string, ms = 4000) => { const t0 = Date.now(); for (;;) { const f = events.find((e) => e.type === type); if (f) return f; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${type}`); await new Promise((r) => setTimeout(r, 25)); } } };
  };
  beforeAll(async () => {
    const o = await request(http).post('/v1/auth/signup').send({ email: 'cad-owner@x.io', password: 'correct-horse-9', name: 'Cora', tenantName: 'Cad Co' }).expect(201);
    owner = o.body.accessToken; tenantId = o.body.tenantId;
    const mk = async (email: string) => {
      const inv = await request(http).post('/v1/invitations').set(auth(owner)).send({ email, role: 'agent' }).expect(201);
      const r = await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: email.split('@')[0], password: 'agent-pass-123' }).expect(201);
      return { tok: r.body.accessToken as string, id: (await request(http).get('/v1/me').set(auth(r.body.accessToken))).body.userId as string };
    };
    agent = await mk('cad-a1@x.io'); other = await mk('cad-a2@x.io');
    leadId = (await request(http).post('/v1/leads').set(auth(agent.tok)).send({ name: 'Cadence Cat', contacts: [{ value: '9812377777' }] }).expect(201)).body.leadId;
  });

  it('definitions are admin-only and validated; first-touch needs an approved template', async () => {
    const steps = [{ offsetMinutes: 0, action: 'task', taskType: 'call', note: 'Call and confirm site visit slot' }, { offsetMinutes: 1440, action: 'task', note: 'Check in again about the visit' }];
    await request(http).post('/v1/cadences').set(auth(agent.tok)).send({ name: 'Visit nudges', steps }).expect(403);
    await request(http).post('/v1/cadences').set(auth(owner)).send({ name: 'Bad', steps: [{ offsetMinutes: 0, action: 'task', note: 'x' }] }).expect(422).expect((r) => expect(r.body.code).toBe('invalid_cadence'));
    await request(http).post('/v1/cadences').set(auth(owner)).send({ name: 'Bad2', steps: [{ offsetMinutes: -5, action: 'task', note: 'Call and confirm' }] }).expect(400);
    const c = (await request(http).post('/v1/cadences').set(auth(owner)).send({ name: 'Visit nudges', steps }).expect(201)).body;
    await request(http).post('/v1/cadences').set(auth(owner)).send({ name: 'Visit nudges', steps }).expect(409);
    expect((await request(http).get('/v1/cadences').set(auth(agent.tok)).expect(200)).body.map((x: any) => x.name)).toEqual(['Visit nudges']);
    expect((await request(http).put(`/v1/cadences/${c._id}`).set(auth(owner)).send({ active: false }).expect(200)).body.active).toBe(false);
    await request(http).post(`/v1/leads/${leadId}/cadences`).set(auth(agent.tok)).send({ cadenceId: c._id }).expect(409).expect((r) => expect(r.body.code).toBe('cadence_inactive'));
    await request(http).put(`/v1/cadences/${c._id}`).set(auth(owner)).send({ active: true }).expect(200);

    expect((await request(http).get('/v1/settings/first-touch').set(auth(owner)).expect(200)).body).toEqual({ enabled: false });
    await request(http).put('/v1/settings/first-touch').set(auth(agent.tok)).send({ enabled: true, channel: 'whatsapp', templateId: 'x', delayMinutes: 0 }).expect(403);
    await request(http).put('/v1/settings/first-touch').set(auth(owner)).send({ enabled: true, channel: 'whatsapp', templateId: '65f0000000000000000000ab', delayMinutes: 0 }).expect(422).expect((r) => expect(r.body.code).toBe('invalid_first_touch'));
    (globalThis as any).__cad = c;
  });

  it('agents enrol and stop cadences on leads they can see; other tenants and other agents cannot', async () => {
    const c = (globalThis as any).__cad;
    const en = (await request(http).post(`/v1/leads/${leadId}/cadences`).set(auth(agent.tok)).send({ cadenceId: c._id }).expect(201)).body;
    expect(en.created).toBe(true);
    const list = (await request(http).get(`/v1/leads/${leadId}/cadences`).set(auth(agent.tok)).expect(200)).body;
    expect(list[0]).toMatchObject({ state: 'active', kind: 'cadence' });
    await request(http).get(`/v1/leads/${leadId}/cadences`).set(auth(other.tok)).expect(403);
    await request(http).delete(`/v1/enrollments/${en.enrollmentId}`).set(auth(other.tok)).expect(403);
    const o2 = await signup('cad-other-tenant');
    await request(http).get(`/v1/leads/${leadId}/cadences`).set(auth(o2.token)).expect(404);
    await request(http).delete(`/v1/enrollments/${en.enrollmentId}`).set(auth(agent.tok)).expect(200);
    expect((await request(http).get(`/v1/leads/${leadId}/cadences`).set(auth(agent.tok)).expect(200)).body[0]).toMatchObject({ state: 'stopped', stoppedReason: 'manual' });
  });

  it('message.in goes only to the lead owner over SSE', async () => {
    const { TENANT_DB } = await import('@leaddesk/platform'); const { runWithTenant } = await import('@leaddesk/db');
    const mine = await openSse(agent.tok); const theirs = await openSse(other.tok);
    await runWithTenant(tenantId, () => app.get(TENANT_DB).repos.outbox.add('message.in', leadId, { channel: 'whatsapp', conversationId: '65f0000000000000000000cc', ownerId: agent.id }));
    const ev = await mine.waitFor('message.in');
    expect(ev.data).toMatchObject({ leadId, channel: 'whatsapp' }); expect(JSON.stringify(ev.data)).not.toContain('9812377777');
    await new Promise((r) => setTimeout(r, 400));
    expect(theirs.events.find((e) => e.type === 'message.in')).toBeUndefined();
    mine.close(); theirs.close();
  });
});
