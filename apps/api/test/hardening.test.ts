import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp } from '@leaddesk/db';
import { hotp, base32Decode, verifyTotp } from '../src/auth/totp';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any;
const mkApp = async (env: Record<string, string>) => {
  Object.assign(process.env, env);
  const { AppModule } = await import('../src/app.module'); const { configureApp } = await import('../src/setup');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const a = configureApp(mod.createNestApplication()); await a.init(); return a;
};
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
/** Test-only: forget per-IP counters (every supertest request comes from the same address). */
const clearIp = async () => {
  const { RATE_STORE } = await import('../src/hardening/hardening.module'); const store: any = app.get(RATE_STORE);
  for (const b of ['login', 'signup', 'refresh', 'accept']) for (const ip of ['::ffff:127.0.0.1', '::1', '127.0.0.1']) await store.reset(`b:${b}:${ip}`);
};
const signup = async (n: string) => {
  await clearIp();
  const r = await request(http).post('/v1/auth/signup').send({ email: `${n}@x.io`, password: 'correct-horse-9', name: n, tenantName: `Co ${n}` }).expect(201);
  return { token: r.body.accessToken as string, tenantId: r.body.tenantId as string, cookie: (r.headers['set-cookie'] as unknown as string[])[0] };
};

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('hard_test');
  process.env.JWT_ACCESS_SECRET = 'hardening-secret-0123456789';
  process.env.LOCAL_KEK_BASE64 = randomBytes(32).toString('base64');
  delete process.env.RATE_LIMITS;
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  // limits ON with small buckets so the behaviour is observable
  app = await mkApp({ RATE_LIMIT_SCALE: '0.3', PUBLIC_APP_URL: 'https://app.example.test', CORS_ORIGINS: 'https://admin.example.test' });
  http = app.getHttpServer();
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

describe('totp primitives', () => {
  it('matches the RFC 4226 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(secret, c))).toEqual(['755224', '287082', '359152', '520489']);
  });
  it('accepts drift of one step, rejects replays, wrong codes and junk', () => {
    const b32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; const now = 59_000 * 1000; const secret = base32Decode(b32);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(b32, hotp(secret, step), now)).toBe(step);
    expect(verifyTotp(b32, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(b32, hotp(secret, step + 2), now)).toBeNull();
    expect(verifyTotp(b32, hotp(secret, step), now, step)).toBeNull(); // already used
    expect(verifyTotp(b32, '12345', now)).toBeNull(); expect(verifyTotp(b32, 'abcdef', now)).toBeNull();
  });
});

describe('http hardening', () => {
  it('sets security headers, removes x-powered-by and never lets API responses be cached', async () => {
    const r = await request(http).get('/v1/me').expect(401);
    expect(r.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
    expect(r.headers['x-powered-by']).toBeUndefined(); expect(r.headers['content-security-policy']).toContain("default-src 'none'");
  });
  it('request ids: a safe client id is kept, an unsafe one is replaced, and the error envelope carries it', async () => {
    const kept = await request(http).get('/v1/me').set('x-request-id', 'client-req-0001').expect(401);
    expect(kept.headers['x-request-id']).toBe('client-req-0001'); expect(kept.body.requestId).toBe('client-req-0001');
    const evil = await request(http).get('/v1/me').set('x-request-id', 'a b\\nc{"x":1}').expect(401);
    expect(evil.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('CORS is closed by default and opens only for allow-listed origins', async () => {
    const no = await request(http).get('/v1/me').set('Origin', 'https://evil.example').expect(401);
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
    await request(http).options('/v1/leads').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET').expect(403);
    const ok = await request(http).options('/v1/leads').set('Origin', 'https://admin.example.test').set('Access-Control-Request-Method', 'GET').expect(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://admin.example.test'); expect(ok.headers['access-control-allow-credentials']).toBe('true');
  });
  it('CSRF: a cross-site request carrying the refresh cookie is blocked; our own origin and non-browser clients pass', async () => {
    const s = await signup('csrf1'); await clearIp();
    await request(http).post('/v1/auth/refresh').set('Cookie', s.cookie).set('Origin', 'https://evil.example').expect(403).expect((r) => expect(r.body.code).toBe('csrf'));
    await request(http).post('/v1/auth/refresh').set('Cookie', s.cookie).set('Sec-Fetch-Site', 'cross-site').expect(403);
    await request(http).post('/v1/auth/logout').set('Cookie', s.cookie).set('Origin', 'https://evil.example').expect(403);
    const ok = await request(http).post('/v1/auth/refresh').set('Cookie', s.cookie).set('Origin', 'https://app.example.test').expect(200); // PUBLIC_APP_URL
    const c2 = (ok.headers['set-cookie'] as unknown as string[])[0];
    await request(http).post('/v1/auth/refresh').set('Cookie', c2).set('Origin', 'https://admin.example.test').expect(200); // CORS_ORIGINS
    const c3 = (await request(http).post('/v1/auth/login').send({ email: 'csrf1@x.io', password: 'correct-horse-9' }).expect(200)).headers['set-cookie'] as unknown as string[];
    await request(http).post('/v1/auth/refresh').set('Cookie', c3[0]).expect(200); // curl-style client: no Origin
  });
  it('input limits: oversized passwords and names are refused before hashing', async () => {
    await request(http).post('/v1/auth/login').send({ email: 'a@x.io', password: 'x'.repeat(5000) }).expect(400);
    await request(http).post('/v1/auth/signup').send({ email: 'big@x.io', password: 'correct-horse-9', name: 'n'.repeat(500), tenantName: 'T1' }).expect(400);
  });
});

describe('rate limits and brute force', () => {
  it('anonymous auth routes are limited per IP and answer 429 with Retry-After and the standard envelope', async () => {
    let last: any;
    for (let i = 0; i < 12; i++) { last = await request(http).post('/v1/auth/login').send({ email: `nobody${i}@x.io`, password: 'whatever-123' }); if (last.status === 429) break; }
    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ code: 'rate_limited', details: { retryAfterS: expect.any(Number) } }); expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect(last.headers['ratelimit-remaining']).toBe('0');
  });
  it('failed sign-ins lock the account (even for the right password) without revealing whether it exists', async () => {
    await signup('lock1');
    await clearIp(); // the per-IP route limit must not mask the account lockout under test
    const email = 'lock1@x.io'; const codes: number[] = [];
    for (let i = 0; i < 6; i++) { await clearIp(); const r = await request(http).post('/v1/auth/login').send({ email, password: 'wrong-password-1' }); codes.push(r.status); }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]); expect(codes[5]).toBe(429);
    await clearIp();
    const good = await request(http).post('/v1/auth/login').send({ email, password: 'correct-horse-9' });
    expect(good.status).toBe(429); expect(good.body.code).toBe('account_locked');
    // an unknown address behaves identically: the lockout does not leak which accounts exist
    const ghost: number[] = [];
    for (let i = 0; i < 6; i++) { await clearIp(); ghost.push((await request(http).post('/v1/auth/login').send({ email: 'ghost@x.io', password: 'wrong-password-1' })).status); }
    expect(ghost).toEqual(codes);
  });
  it('authenticated traffic is limited per user, independently for each user', async () => {
    const a = await signup('rl-a'); const b = await signup('rl-b');
    const { RATE_STORE } = await import('../src/hardening/hardening.module'); const store: any = app.get(RATE_STORE);
    const { rateConfigFromEnv } = await import('@leaddesk/platform'); const limit = rateConfigFromEnv().buckets.user.limit;
    expect(limit).toBe(180);
    const uid = (await request(http).get('/v1/me').set(auth(a.token)).expect(200)).body.userId;
    for (let i = 0; i < limit - 1; i++) await store.hit(`u:${uid}`, 60_000); // burn the budget directly: faster than 180 requests
    const over = await request(http).get('/v1/me').set(auth(a.token)); // 181st hit overall
    expect(over.status).toBe(429); expect(over.body.code).toBe('rate_limited');
    await request(http).get('/v1/me').set(auth(b.token)).expect(200); // another user is unaffected
  });
});

describe('two-factor, sessions and account state', () => {
  it('TOTP: setup -> enable (recovery codes shown once) -> login needs a code -> codes are single use -> disable', async () => {
    const s = await signup('tfa1');
    const setup = (await request(http).post('/v1/auth/2fa/setup').set(auth(s.token)).expect(201)).body;
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/LeadDesk:tfa1%40x\.io\?secret=[A-Z2-7]+/);
    await request(http).post('/v1/auth/2fa/enable').set(auth(s.token)).send({ code: '000000' }).expect(422);
    const secret = base32Decode(setup.secret); const stepNow = () => Math.floor(Date.now() / 30_000);
    const en = (await request(http).post('/v1/auth/2fa/enable').set(auth(s.token)).send({ code: hotp(secret, stepNow()) }).expect(201)).body;
    expect(en.recoveryCodes).toHaveLength(10); expect(en.recoveryCodes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    const { TENANT_DB } = await import('@leaddesk/platform'); const u: any = await app.get(TENANT_DB).models.User.findOne({ email: 'tfa1@x.io' }).lean().exec();
    expect(JSON.stringify(u)).not.toContain(setup.secret); expect(JSON.stringify(u)).not.toContain(en.recoveryCodes[0]); // sealed / hashed at rest

    const attempt = (b: Record<string, unknown>) => request(http).post('/v1/auth/login').send({ email: 'tfa1@x.io', password: 'correct-horse-9', ...b });
    const { RATE_STORE } = await import('../src/hardening/hardening.module'); const store: any = app.get(RATE_STORE);
    const clear = async () => { await clearIp(); for (const k of ['lf:tfa1@x.io|::ffff:127.0.0.1', 'lf:tfa1@x.io|127.0.0.1', 'lf:tfa1@x.io|::1', 'lf:tfa1@x.io']) await store.reset(k); };
    await clear();
    expect((await attempt({})).body).toMatchObject({ code: 'totp_required' });
    await clear(); expect((await attempt({ totp: '123456' })).status).toBe(401);
    await clear();
    const ok = await attempt({ totp: hotp(secret, stepNow() + 1) }); // within the allowed drift, later than the enrolment step
    expect(ok.status).toBe(200); expect(ok.body.accessToken).toBeTruthy();
    await clear(); expect((await attempt({ totp: hotp(secret, stepNow() + 1) })).status).toBe(401); // same code twice: replay refused
    await clear(); expect((await attempt({ totp: en.recoveryCodes[0] })).status).toBe(200);
    await clear(); expect((await attempt({ totp: en.recoveryCodes[0] })).status).toBe(401); // recovery codes burn on use
    await request(http).post('/v1/auth/2fa/disable').set(auth(s.token)).send({ password: 'wrong', code: en.recoveryCodes[1] }).expect(401);
    await request(http).post('/v1/auth/2fa/disable').set(auth(s.token)).send({ password: 'correct-horse-9', code: en.recoveryCodes[1] }).expect(200);
    await clear(); expect((await attempt({})).status).toBe(200); // back to password only
    await request(http).post('/v1/auth/2fa/enable').set(auth(s.token)).send({ code: '123456' }).expect(409);
  });

  it('logout-all and password change revoke every session; disabled users and suspended workspaces cannot refresh or call the API', async () => {
    const s = await signup('sess1');
    const { RATE_STORE } = await import('../src/hardening/hardening.module'); const store: any = app.get(RATE_STORE);
    const clear = async () => { await clearIp(); void store; };
    await clear(); const l2 = (await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'correct-horse-9' }).expect(200)).headers['set-cookie'] as unknown as string[];
    await request(http).post('/v1/auth/logout-all').set(auth(s.token)).expect(200);
    await request(http).post('/v1/auth/refresh').set('Cookie', s.cookie).expect(401); await request(http).post('/v1/auth/refresh').set('Cookie', l2[0]).expect(401);

    await clear(); const l3 = await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'correct-horse-9' }).expect(200);
    const cookie3 = (l3.headers['set-cookie'] as unknown as string[])[0];
    await request(http).post('/v1/auth/password').set(auth(l3.body.accessToken)).send({ current: 'nope-nope-nope', next: 'brand-new-pass-1' }).expect(401);
    await request(http).post('/v1/auth/password').set(auth(l3.body.accessToken)).send({ current: 'correct-horse-9', next: 'brand-new-pass-1' }).expect(200);
    await request(http).post('/v1/auth/refresh').set('Cookie', cookie3).expect(401);
    await clear(); await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'correct-horse-9' }).expect(401);
    await clear(); const l4 = await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'brand-new-pass-1' }).expect(200);

    const { TENANT_DB } = await import('@leaddesk/platform'); const db: any = app.get(TENANT_DB);
    const cookie4 = (l4.headers['set-cookie'] as unknown as string[])[0];
    await db.models.User.updateOne({ email: 'sess1@x.io' }, { $set: { status: 'disabled' } });
    await request(http).post('/v1/auth/refresh').set('Cookie', cookie4).expect(401); // a disabled user cannot mint new tokens
    await db.models.User.updateOne({ email: 'sess1@x.io' }, { $set: { status: 'active' } });
    const l5 = await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'brand-new-pass-1' }).expect(200);
    await db.models.Tenant.updateOne({ _id: s.tenantId }, { $set: { status: 'suspended' } });
    await request(http).post('/v1/auth/refresh').set('Cookie', (l5.headers['set-cookie'] as unknown as string[])[0]).expect(401);
    await clear(); await request(http).post('/v1/auth/login').send({ email: 'sess1@x.io', password: 'brand-new-pass-1' }).expect(403);
  });
});

describe('OpenAPI', () => {
  it('serves the API description (paths for every module, bearer auth) outside production', async () => {
    const doc = (await request(http).get('/openapi.json').expect(200)).body;
    expect(doc.openapi).toMatch(/^3\./); expect(doc.components.securitySchemes.bearer).toBeDefined();
    for (const p of ['/v1/auth/login', '/v1/leads', '/v1/do/queue', '/v1/pulse/kpis', '/v1/ai/settings', '/v1/messages', '/v1/tenant/export', '/healthz']) expect(Object.keys(doc.paths), p).toContain(p);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(100);
    // request bodies carry real schemas generated from the validation decorators
    const s = doc.components.schemas;
    const { dtoClasses } = await import('../src/openapi'); const clashes: string[] = []; dtoClasses(app, (n) => clashes.push(n)); expect(clashes, 'two request classes share a name, so their schemas would overwrite each other').toEqual([]);
    expect(s.SignupDto).toMatchObject({ type: 'object', required: expect.arrayContaining(['email', 'password', 'name', 'tenantName']) });
    expect(s.SignupDto.required).not.toContain('country'); // @IsOptional
    expect(s.SignupDto.properties).toMatchObject({ email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 10, maxLength: 128 }, country: { type: 'string' } });
    expect(s.InviteDto.properties.role).toMatchObject({ type: 'string', enum: ['admin', 'manager', 'agent'] });
    expect(s.CheckoutDto.properties.seats).toMatchObject({ type: 'integer', minimum: 1, maximum: 500 });
    expect(s.StatusDefDto.properties.requiresFields).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(s.RulesDto.properties.rules).toEqual({ type: 'array', items: { $ref: '#/components/schemas/RuleDto' } }); expect(s.RuleDto.required).toEqual(expect.arrayContaining(['name', 'action']));
    expect(doc.paths['/v1/auth/signup'].post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/SignupDto' });
  });
});

describe('workspace two-factor policy', () => {
  it('owner can require two-factor for roles; those people can only reach account security until they set it up; the owner cannot lock themselves out', async () => {
    const o = await signup('pol-owner');
    const inv = await request(http).post('/v1/invitations').set(auth(o.token)).send({ email: 'pol-admin@x.io', role: 'admin' }).expect(201);
    const inv2 = await request(http).post('/v1/invitations').set(auth(o.token)).send({ email: 'pol-agent@x.io', role: 'agent' }).expect(201);
    const admin = (await request(http).post(`/v1/invitations/${inv.body.inviteToken}/accept`).send({ name: 'pa', password: 'agent-pass-123' }).expect(201)).body.accessToken as string;
    const agent = (await request(http).post(`/v1/invitations/${inv2.body.inviteToken}/accept`).send({ name: 'pg', password: 'agent-pass-123' }).expect(201)).body.accessToken as string;
    expect((await request(http).get('/v1/security/policy').set(auth(o.token)).expect(200)).body).toEqual({ require2faRoles: [] });
    await request(http).put('/v1/security/policy').set(auth(admin)).send({ require2faRoles: ['admin'] }).expect(403); // owner only
    await request(http).put('/v1/security/policy').set(auth(o.token)).send({ require2faRoles: ['boss'] }).expect(400);
    await request(http).put('/v1/security/policy').set(auth(o.token)).send({ require2faRoles: ['owner', 'admin'] }).expect(409).expect((r) => expect(r.body.code).toBe('enable_2fa_first')); // would lock the owner out
    // the owner turns 2FA on for themselves, then the policy
    const setup = (await request(http).post('/v1/auth/2fa/setup').set(auth(o.token)).expect(201)).body; const stepNow = () => Math.floor(Date.now() / 30_000);
    await request(http).post('/v1/auth/2fa/enable').set(auth(o.token)).send({ code: hotp(base32Decode(setup.secret), stepNow()) }).expect(201);
    await request(http).put('/v1/security/policy').set(auth(o.token)).send({ require2faRoles: ['owner', 'admin'] }).expect(200).expect((r) => expect(r.body.require2faRoles).toEqual(['owner', 'admin']));
    const { MembershipCache } = await import('../src/common/guards'); app.get(MembershipCache).clear();
    // the owner is fine; the admin without a second factor is held at account security; the agent is not covered
    await request(http).get('/v1/leads').set(auth(o.token)).expect(200);
    await request(http).get('/v1/leads').set(auth(admin)).expect(403).expect((r) => expect(r.body.code).toBe('two_factor_required'));
    expect((await request(http).get('/v1/me').set(auth(admin)).expect(200)).body.needs2fa).toBe(true);
    await request(http).get('/v1/billing/status').set(auth(admin)).expect(403);
    await request(http).get('/v1/leads').set(auth(agent)).expect(200);
    const asetup = (await request(http).post('/v1/auth/2fa/setup').set(auth(admin)).expect(201)).body; // account security stays reachable
    await request(http).post('/v1/auth/2fa/enable').set(auth(admin)).send({ code: hotp(base32Decode(asetup.secret), stepNow()) }).expect(201);
    await request(http).get('/v1/leads').set(auth(admin)).expect(200); // enabling releases them at once (cache cleared on this instance)
    expect((await request(http).get('/v1/me').set(auth(admin)).expect(200)).body.needs2fa).toBeUndefined();
    // turning the policy off releases everyone; a role can also be removed
    await request(http).put('/v1/security/policy').set(auth(o.token)).send({ require2faRoles: [] }).expect(200);
    expect((await request(http).get('/v1/security/policy').set(auth(o.token)).expect(200)).body.require2faRoles).toEqual([]);
  });
});

describe('passkeys (WebAuthn) as a second factor', () => {
  const RP = 'app.example.test'; const ORIGIN = 'https://app.example.test'; // hardening.test sets PUBLIC_APP_URL
  it('register with a (software) authenticator, sign in with it, and refuse replays, wrong origins, other users\' keys and stale counters', async () => {
    const { SoftKey } = await import('./softkey');
    const a = await signup('pk-a'); const b = await signup('pk-b');
    const key = new SoftKey();
    const reg = (await request(http).post('/v1/auth/passkeys/register/options').set(auth(a.token)).expect(200)).body;
    expect(reg.options).toMatchObject({ rp: { id: RP, name: 'LeadDesk' }, attestation: 'none' }); expect(reg.challengeToken).toBeTruthy();
    await request(http).post('/v1/auth/passkeys/register/verify').set(auth(a.token)).send({ challengeToken: reg.challengeToken, response: key.register(RP, 'https://evil.example', reg.options.challenge) }).expect(400); // wrong origin
    const reg2 = (await request(http).post('/v1/auth/passkeys/register/options').set(auth(a.token)).expect(200)).body;
    await request(http).post('/v1/auth/passkeys/register/verify').set(auth(b.token)).send({ challengeToken: reg2.challengeToken, response: key.register(RP, ORIGIN, reg2.options.challenge) }).expect(400); // someone else's challenge
    const att = key.register(RP, ORIGIN, reg2.options.challenge);
    const list = (await request(http).post('/v1/auth/passkeys/register/verify').set(auth(a.token)).send({ challengeToken: reg2.challengeToken, response: att, name: 'Dev laptop' }).expect(200)).body;
    expect(list).toEqual([expect.objectContaining({ name: 'Dev laptop', lastUsedAt: null })]); expect(JSON.stringify(list)).not.toContain('publicKey');
    await request(http).post('/v1/auth/passkeys/register/verify').set(auth(a.token)).send({ challengeToken: reg2.challengeToken, response: att }).expect(400); // the challenge is single use

    await clearIp();
    const attempt = (b2: Record<string, unknown> = {}) => request(http).post('/v1/auth/login').send({ email: 'pk-a@x.io', password: 'correct-horse-9', ...b2 });
    const first = await attempt(); expect(first.status).toBe(401); expect(first.body.code).toBe('second_factor_required');
    expect(first.body.details.methods).toEqual(['passkey']); expect(first.body.details.passkey.options.allowCredentials).toEqual([expect.objectContaining({ id: key.id.toString('base64url') })]);
    const ok = await attempt({ passkey: { challengeToken: first.body.details.passkey.challengeToken, response: key.assert(RP, ORIGIN, first.body.details.passkey.options.challenge) } });
    expect(ok.status).toBe(200); expect(ok.body.accessToken).toBeTruthy();
    // replay of the same signed response, and a fresh response on a spent challenge
    const replay = await attempt({ passkey: { challengeToken: first.body.details.passkey.challengeToken, response: key.assert(RP, ORIGIN, first.body.details.passkey.options.challenge) } });
    expect(replay.status).toBe(401); expect(replay.body.code).toBe('passkey_invalid');
    // wrong origin (a phishing page cannot get a usable assertion), the other user's key, and a cloned authenticator (counter not moving forward)
    await clearIp(); const second = (await attempt()).body.details.passkey;
    expect((await attempt({ passkey: { challengeToken: second.challengeToken, response: key.assert(RP, 'https://evil.example', second.options.challenge) } })).status).toBe(401);
    await clearIp(); const third = (await attempt()).body.details.passkey;
    const stale = key.assert(RP, ORIGIN, third.options.challenge, { counter: 1 }); // the store already holds a higher counter
    expect((await attempt({ passkey: { challengeToken: third.challengeToken, response: stale } })).status).toBe(401);
    await clearIp(); const forth = (await attempt()).body.details.passkey; const other = new SoftKey();
    expect((await attempt({ passkey: { challengeToken: forth.challengeToken, response: other.assert(RP, ORIGIN, forth.options.challenge) } })).status).toBe(401); // unknown credential
    // password alone is still not enough, and a wrong password never reveals the passkey options
    expect((await request(http).post('/v1/auth/login').send({ email: 'pk-a@x.io', password: 'wrong-password-1' })).body.details?.passkey).toBeUndefined();
    // management: list, and removing needs the password
    const id = key.id.toString('base64url');
    await request(http).post(`/v1/auth/passkeys/${id}/remove`).set(auth(a.token)).send({ password: 'nope-nope-nope' }).expect(401);
    expect((await request(http).get('/v1/auth/passkeys').set(auth(a.token)).expect(200)).body[0].lastUsedAt).not.toBeNull();
    await request(http).post(`/v1/auth/passkeys/${id}/remove`).set(auth(b.token)).send({ password: 'correct-horse-9' }).expect(404); // not b's passkey
    expect((await request(http).post(`/v1/auth/passkeys/${id}/remove`).set(auth(a.token)).send({ password: 'correct-horse-9' }).expect(200)).body).toEqual([]);
    const { RATE_STORE } = await import('../src/hardening/hardening.module'); const store: any = app.get(RATE_STORE);
    await clearIp(); for (const k of ['lf:pk-a@x.io|::ffff:127.0.0.1', 'lf:pk-a@x.io|127.0.0.1', 'lf:pk-a@x.io|::1', 'lf:pk-a@x.io']) await store.reset(k); // the failed attempts above counted toward the lockout
    await attempt().then((r) => expect(r.status).toBe(200)); // back to password only
  });

  it('a passkey satisfies a workspace two-factor policy', async () => {
    const { SoftKey } = await import('./softkey'); const { MembershipCache } = await import('../src/common/guards');
    const o = await signup('pk-owner'); const key = new SoftKey();
    const reg = (await request(http).post('/v1/auth/passkeys/register/options').set(auth(o.token)).expect(200)).body;
    await request(http).post('/v1/auth/passkeys/register/verify').set(auth(o.token)).send({ challengeToken: reg.challengeToken, response: key.register(RP, ORIGIN, reg.options.challenge) }).expect(200);
    await request(http).put('/v1/security/policy').set(auth(o.token)).send({ require2faRoles: ['owner'] }).expect(200); // allowed: the owner has a second factor (a passkey)
    app.get(MembershipCache).clear(); await request(http).get('/v1/leads').set(auth(o.token)).expect(200);
  });
});
