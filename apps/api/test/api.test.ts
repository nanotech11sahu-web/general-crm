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
