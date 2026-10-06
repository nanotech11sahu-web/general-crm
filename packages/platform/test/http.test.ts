import { describe, expect, it } from 'vitest';
import { check, createLogger, MemoryRateStore, FailOpenStore, rateConfigFromEnv, redact, validateEnv, type RateStore } from '../src';

describe('logger', () => {
  it('writes JSON lines and redacts credentials, cookies and bodies', () => {
    const lines: string[] = [];
    createLogger({ service: 't', level: 'info', sink: (l) => lines.push(l) }).info('hello', { requestId: 'r1', headers: { authorization: 'Bearer abc', cookie: 'ld_refresh=zzz', accept: 'x' }, body: { password: 'p' }, nested: { apiKey: 'k', ok: 1 } });
    const o = JSON.parse(lines[0]);
    expect(o).toMatchObject({ level: 'info', service: 't', msg: 'hello', requestId: 'r1', headers: { authorization: '[redacted]', cookie: '[redacted]', accept: 'x' }, body: '[redacted]', nested: { apiKey: '[redacted]', ok: 1 } });
    expect(lines[0]).not.toMatch(/abc|zzz|"p"/);
  });
  it('respects the level and truncates giant strings', () => {
    const lines: string[] = []; const l = createLogger({ service: 't', level: 'warn', sink: (x) => lines.push(x) });
    l.info('quiet'); l.error('loud'); expect(lines).toHaveLength(1);
    expect((redact({ s: 'x'.repeat(2000) }) as any).s.length).toBeLessThan(600);
  });
});

describe('rate limiting', () => {
  it('fixed window: counts, blocks over the limit, resets after the window, keys are independent', async () => {
    let t = 1_000_000; const s = new MemoryRateStore(() => t);
    const b = { limit: 3, windowS: 10 };
    expect((await check(s, 'a', b)).remaining).toBe(2); await check(s, 'a', b);
    const third = await check(s, 'a', b); expect(third).toMatchObject({ allowed: true, remaining: 0 });
    const fourth = await check(s, 'a', b); expect(fourth.allowed).toBe(false); expect(fourth.resetAt).toBe(t + 10_000);
    expect((await check(s, 'other', b)).allowed).toBe(true);
    t += 10_001; expect((await check(s, 'a', b)).allowed).toBe(true);
    await s.reset('a'); expect(await s.peek('a')).toBeNull(); await s.close();
  });
  it('a store outage fails open instead of locking everyone out', async () => {
    const broken: RateStore = { hit: async () => { throw new Error('redis down'); }, peek: async () => { throw new Error('x'); }, reset: async () => { throw new Error('x'); } };
    const errs: unknown[] = []; const s = new FailOpenStore(broken, (e) => errs.push(e));
    expect((await check(s, 'k', { limit: 1, windowS: 1 })).allowed).toBe(true); expect(await s.peek('k')).toBeNull(); await s.reset('k'); expect(errs).toHaveLength(3);
  });
  it('config: scale and off switch', () => {
    expect(rateConfigFromEnv({ RATE_LIMIT_SCALE: '0.5' } as any).buckets.login.limit).toBe(5);
    expect(rateConfigFromEnv({ RATE_LIMITS: 'off' } as any).enabled).toBe(false);
  });
});

describe('boot configuration', () => {
  const good = { NODE_ENV: 'production', MONGO_URL: 'mongodb://x', JWT_ACCESS_SECRET: 'k'.repeat(40), OBJECT_SIGNING_SECRET: 'q'.repeat(40), LOCAL_KEK_BASE64: Buffer.alloc(32, 7).toString('base64'), PUBLIC_APP_URL: 'https://app.example.in', REDIS_URL: 'redis://r' } as NodeJS.ProcessEnv;
  it('accepts a sound production config', () => { expect(validateEnv(good)).toEqual([]); });
  it('refuses weak, placeholder or missing settings in production', () => {
    expect(validateEnv({ ...good, JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' })).toEqual(expect.arrayContaining([expect.stringContaining('JWT_ACCESS_SECRET')]));
    expect(validateEnv({ ...good, JWT_ACCESS_SECRET: 'short' }).length).toBeGreaterThan(0);
    expect(validateEnv({ ...good, OBJECT_SIGNING_SECRET: undefined })).toEqual(expect.arrayContaining([expect.stringContaining('OBJECT_SIGNING_SECRET')]));
    expect(validateEnv({ ...good, LOCAL_KEK_BASE64: undefined })).toEqual(expect.arrayContaining([expect.stringContaining('key-encryption key')]));
    expect(validateEnv({ ...good, LOCAL_KEK_BASE64: 'AAAA' })).toEqual(expect.arrayContaining([expect.stringContaining('32 bytes')]));
    expect(validateEnv({ ...good, PUBLIC_APP_URL: 'http://x' })).toEqual(expect.arrayContaining([expect.stringContaining('https')]));
    expect(validateEnv({ ...good, RATE_LIMITS: 'off' })).toEqual(expect.arrayContaining([expect.stringContaining('RATE_LIMITS')]));
    expect(validateEnv({ ...good, REDIS_URL: undefined })).toEqual(expect.arrayContaining([expect.stringContaining('REDIS_URL')]));
  });
  it('development only needs a JWT secret and a database', () => {
    expect(validateEnv({ MONGO_URL: 'm', JWT_ACCESS_SECRET: 'x'.repeat(16) } as any, false)).toEqual([]);
    expect(validateEnv({} as any, false)).toHaveLength(2);
  });
});
