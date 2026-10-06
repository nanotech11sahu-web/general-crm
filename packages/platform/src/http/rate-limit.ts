import IORedis from 'ioredis';

export interface RateHit { count: number; resetAt: number }
/** Fixed-window counters. Redis in production (shared across instances), memory otherwise. */
export interface RateStore {
  hit(key: string, windowMs: number): Promise<RateHit>;
  peek(key: string): Promise<RateHit | null>;
  reset(key: string): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryRateStore implements RateStore {
  private readonly m = new Map<string, RateHit>();
  private readonly timer: NodeJS.Timeout;
  constructor(private readonly now: () => number = Date.now) {
    this.timer = setInterval(() => { const t = this.now(); for (const [k, v] of this.m) if (v.resetAt <= t) this.m.delete(k); }, 30_000);
    this.timer.unref();
  }
  async hit(key: string, windowMs: number) {
    const t = this.now(); const cur = this.m.get(key);
    if (!cur || cur.resetAt <= t) { const n = { count: 1, resetAt: t + windowMs }; this.m.set(key, n); return n; }
    cur.count++; return { ...cur };
  }
  async peek(key: string) { const c = this.m.get(key); return c && c.resetAt > this.now() ? { ...c } : null; }
  async reset(key: string) { this.m.delete(key); }
  async close() { clearInterval(this.timer); }
}

const LUA = `local c = redis.call('INCR', KEYS[1]) if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end local t = redis.call('PTTL', KEYS[1]) return {c, t}`;
export class RedisRateStore implements RateStore {
  private readonly r: IORedis;
  constructor(url: string, private readonly prefix = 'rl:') { this.r = new IORedis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: false }); this.r.on('error', () => undefined); }
  async hit(key: string, windowMs: number) {
    const [count, ttl] = (await this.r.eval(LUA, 1, this.prefix + key, String(windowMs))) as [number, number];
    return { count, resetAt: Date.now() + Math.max(ttl, 0) };
  }
  async peek(key: string) {
    const [c, ttl] = await Promise.all([this.r.get(this.prefix + key), this.r.pttl(this.prefix + key)]);
    return c ? { count: Number(c), resetAt: Date.now() + Math.max(ttl, 0) } : null;
  }
  async reset(key: string) { await this.r.del(this.prefix + key); }
  async close() { await this.r.quit().catch(() => undefined); }
}

/** A Redis outage must not take the product down: fail open (and the caller logs it). */
export class FailOpenStore implements RateStore {
  constructor(private readonly inner: RateStore, private readonly onError: (e: unknown) => void = () => undefined) {}
  async hit(k: string, w: number) { try { return await this.inner.hit(k, w); } catch (e) { this.onError(e); return { count: 0, resetAt: Date.now() + w }; } }
  async peek(k: string) { try { return await this.inner.peek(k); } catch (e) { this.onError(e); return null; } }
  async reset(k: string) { try { await this.inner.reset(k); } catch (e) { this.onError(e); } }
  async close() { await this.inner.close?.(); }
}

export function rateStoreFromEnv(env: NodeJS.ProcessEnv = process.env, onError?: (e: unknown) => void): RateStore {
  return env.REDIS_URL ? new FailOpenStore(new RedisRateStore(env.REDIS_URL), onError) : new MemoryRateStore();
}

export interface Bucket { limit: number; windowS: number }
export const DEFAULT_BUCKETS = {
  login: { limit: 10, windowS: 60 }, signup: { limit: 5, windowS: 3600 }, accept: { limit: 10, windowS: 60 }, refresh: { limit: 60, windowS: 60 },
  user: { limit: 600, windowS: 60 }, tenant: { limit: 3000, windowS: 60 }, ip: { limit: 600, windowS: 60 }, webhook: { limit: 6000, windowS: 60 },
} satisfies Record<string, Bucket>;
export type BucketName = keyof typeof DEFAULT_BUCKETS;
export interface RateConfig { enabled: boolean; buckets: Record<BucketName, Bucket>; lockout: { perAccountIp: number; perAccount: number; windowS: number } }
export function rateConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RateConfig {
  const scale = Number(env.RATE_LIMIT_SCALE ?? 1) || 1;
  return {
    enabled: env.RATE_LIMITS !== 'off',
    buckets: Object.fromEntries(Object.entries(DEFAULT_BUCKETS).map(([k, b]) => [k, { ...b, limit: Math.max(1, Math.round(b.limit * scale)) }])) as Record<BucketName, Bucket>,
    lockout: { perAccountIp: 5, perAccount: 25, windowS: 900 },
  };
}

export interface Verdict { allowed: boolean; limit: number; remaining: number; resetAt: number }
export async function check(store: RateStore, key: string, b: Bucket): Promise<Verdict> {
  const h = await store.hit(key, b.windowS * 1000);
  return { allowed: h.count <= b.limit, limit: b.limit, remaining: Math.max(0, b.limit - h.count), resetAt: h.resetAt };
}
