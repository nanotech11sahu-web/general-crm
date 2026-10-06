import { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { check, createLogger, rateConfigFromEnv, rateStoreFromEnv, requestContext, securityHeaders, type RateConfig, type RateStore } from '@leaddesk/platform';

const BAD_SIG = { limit: 60, windowS: 60 };
const APP_LEVEL = new Set(['meta-leadads', 'whatsapp-cloud']); // one shared callback URL for every tenant: never throttled by connection

/**
 * Webhook abuse limits that cannot hurt real providers:
 *  - per-connection ceiling (a runaway source cannot starve others), skipped for app-level hooks (Meta/WhatsApp share one URL);
 *  - per-IP counter of *rejected* requests (401/404), so signature guessing is cut off while valid traffic is never throttled by IP.
 */
export function webhookGuard(store: RateStore, cfg: RateConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.enabled || !req.path.startsWith('/hooks/')) return next();
    const ip = req.ip ?? 'unknown';
    const bad = await store.peek(`badsig:${ip}`);
    if (bad && bad.count >= BAD_SIG.limit) { res.setHeader('Retry-After', Math.max(1, Math.ceil((bad.resetAt - Date.now()) / 1000))); return res.status(429).json({ code: 'rate_limited', message: 'Too many rejected requests' }); }
    const [, , provider, publicId] = req.path.split('/');
    if (publicId && !APP_LEVEL.has(provider)) {
      const v = await check(store, `wh:${provider}:${publicId}`, cfg.buckets.webhook);
      if (!v.allowed) { res.setHeader('Retry-After', Math.max(1, Math.ceil((v.resetAt - Date.now()) / 1000))); return res.status(429).json({ code: 'rate_limited', message: 'This webhook is receiving too many requests' }); }
    }
    res.on('finish', () => { if (res.statusCode === 401 || res.statusCode === 404) void store.hit(`badsig:${ip}`, BAD_SIG.windowS * 1000); });
    next();
  };
}

export function configureIngress(app: INestApplication, o: { store?: RateStore; cfg?: RateConfig } = {}) {
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  if (process.env.TRUST_PROXY) http.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  const log = createLogger({ service: 'ingress' });
  app.use(requestContext(log));
  app.use(securityHeaders({ hsts: process.env.NODE_ENV === 'production' }));
  app.use(webhookGuard(o.store ?? rateStoreFromEnv(process.env, (e) => log.warn('rate store unavailable, failing open', { error: String((e as Error)?.message ?? e) })), o.cfg ?? rateConfigFromEnv()));
  return app;
}
