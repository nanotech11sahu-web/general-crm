import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Logger } from './logger';

const REQ_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Always a safe id: a client-supplied one is accepted only if it cannot inject into logs or headers. */
export function requestContext(log: Logger) {
  return (req: Request & { id?: string; user?: { userId?: string; tenantId?: string } }, res: Response, next: NextFunction) => {
    const given = req.headers['x-request-id'];
    const id = typeof given === 'string' && REQ_ID.test(given) ? given : randomUUID();
    req.id = id; req.headers['x-request-id'] = id; res.setHeader('x-request-id', id);
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      log[res.statusCode >= 500 ? 'error' : 'info']('http', { requestId: id, method: req.method, route: `${req.baseUrl ?? ''}${route}`, status: res.statusCode, ms: Math.round(ms * 10) / 10, tenantId: req.user?.tenantId, userId: req.user?.userId, ip: req.ip });
    });
    next();
  };
}

export function securityHeaders(o: { hsts?: boolean } = {}) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'"); // JSON/audio only: nothing here is a document
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (o.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

/** Same-origin by default (the web app proxies /v1). Cross-origin access is an explicit allow-list. */
export function cors(allowed: string[]) {
  const set = new Set(allowed.map((x) => x.replace(/\/$/, '')));
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && set.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', 'x-request-id, retry-after, ratelimit-limit, ratelimit-remaining, ratelimit-reset');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE'); res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,idempotency-key,last-event-id,x-request-id'); res.setHeader('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    } else if (origin && req.method === 'OPTIONS') return res.status(403).end(); // preflight from an origin we do not know
    next();
  };
}

/**
 * CSRF for cookie-authenticated requests (the refresh cookie): an unsafe request that presents the cookie and no bearer token
 * must come from our own origin. SameSite=Strict already stops cross-site; this covers same-site siblings and old browsers.
 * Non-browser clients send no Origin and no Sec-Fetch-Site and are not affected.
 */
export function csrf(o: { allowedOrigins: string[]; cookie: string }) {
  const allow = new Set(o.allowedOrigins.map((x) => x.replace(/\/$/, '')));
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.headers.authorization || !String(req.headers.cookie ?? '').includes(`${o.cookie}=`)) return next();
    const origin = req.headers.origin as string | undefined; const site = req.headers['sec-fetch-site'] as string | undefined;
    if (!origin && !site) return next();
    const fwdHost = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    const self = fwdHost ? `${proto}://${fwdHost}` : '';
    const ok = origin ? (allow.has(origin) || origin === self) : (site === 'same-origin' || site === 'none');
    if (ok) return next();
    return res.status(403).json({ code: 'csrf', message: 'Cross-site request blocked', requestId: req.headers['x-request-id'] });
  };
}

/** Production refuses to boot with weak or placeholder configuration. */
export function validateEnv(env: NodeJS.ProcessEnv, production = env.NODE_ENV === 'production'): string[] {
  const p: string[] = [];
  const weak = (v?: string) => !v || /change-?me|changeme|dev-only|example|secret$|password/i.test(v);
  if (!env.MONGO_URL) p.push('MONGO_URL is required');
  if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 16) p.push('JWT_ACCESS_SECRET must be set (16+ characters)');
  if (production) {
    if ((env.JWT_ACCESS_SECRET ?? '').length < 32 || weak(env.JWT_ACCESS_SECRET)) p.push('JWT_ACCESS_SECRET must be 32+ random characters, not a placeholder');
    if (!env.OBJECT_SIGNING_SECRET || env.OBJECT_SIGNING_SECRET.length < 32 || weak(env.OBJECT_SIGNING_SECRET)) p.push('OBJECT_SIGNING_SECRET must be 32+ random characters, not a placeholder');
    if (!env.LOCAL_KEK_BASE64 && !env.KMS_KEY_ID) p.push('A key-encryption key is required (KMS_KEY_ID, or LOCAL_KEK_BASE64 for single-node installs)');
    if (env.LOCAL_KEK_BASE64 && Buffer.from(env.LOCAL_KEK_BASE64, 'base64').length !== 32) p.push('LOCAL_KEK_BASE64 must decode to exactly 32 bytes');
    if (!env.PUBLIC_APP_URL?.startsWith('https://')) p.push('PUBLIC_APP_URL must be an https:// URL');
    if (env.RATE_LIMITS === 'off') p.push('RATE_LIMITS=off is not allowed in production');
    if (!env.REDIS_URL) p.push('REDIS_URL is required in production (shared rate limits and queues)');
  }
  return p;
}
