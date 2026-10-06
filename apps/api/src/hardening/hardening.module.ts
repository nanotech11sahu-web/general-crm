import { CanActivate, ExecutionContext, Global, Inject, Injectable, Module, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@leaddesk/domain';
import { check, createLogger, rateConfigFromEnv, rateStoreFromEnv, type BucketName, type Logger, type RateConfig, type RateStore } from '@leaddesk/platform';
import type { AuthUser } from '../common/auth.types';

export const LOGGER = Symbol('LOGGER');
export const RATE_STORE = Symbol('RATE_STORE');
export const RATE_CONFIG = Symbol('RATE_CONFIG');
export const RATE_BUCKET = 'rate_bucket';
/** Named per-IP bucket for unauthenticated, abuse-prone routes (login, signup, invite accept, refresh). */
export const RateLimit = (b: BucketName) => SetMetadata(RATE_BUCKET, b);

/** Runs after JwtAuthGuard: authenticated traffic is limited per user and per tenant, anonymous traffic per IP. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(RATE_STORE) private readonly store: RateStore, @Inject(RATE_CONFIG) private readonly cfg: RateConfig) {}
  async canActivate(ctx: ExecutionContext) {
    if (!this.cfg.enabled) return true;
    const http = ctx.switchToHttp(); const req = http.getRequest(); const res = http.getResponse();
    const named = this.reflector.getAllAndOverride<BucketName | undefined>(RATE_BUCKET, [ctx.getHandler(), ctx.getClass()]);
    const user: AuthUser | undefined = req.user; const ip = req.ip ?? 'unknown';
    const keys: [string, keyof RateConfig['buckets']][] = named ? [[`b:${named}:${ip}`, named]] : user ? [[`u:${user.userId}`, 'user'], [`t:${user.tenantId}`, 'tenant']] : [[`ip:${ip}`, 'ip']];
    let worst: Awaited<ReturnType<typeof check>> | undefined;
    for (const [k, b] of keys) { const v = await check(this.store, k, this.cfg.buckets[b]); if (!worst || v.remaining < worst.remaining) worst = v; if (!v.allowed) break; }
    res.setHeader('RateLimit-Limit', worst!.limit); res.setHeader('RateLimit-Remaining', worst!.remaining); res.setHeader('RateLimit-Reset', Math.ceil(Math.max(0, worst!.resetAt - Date.now()) / 1000));
    if (!worst!.allowed) {
      const retry = Math.max(1, Math.ceil((worst!.resetAt - Date.now()) / 1000)); res.setHeader('Retry-After', retry);
      throw new DomainError('rate_limited', 'Too many requests. Slow down and retry shortly.', { retryAfterS: retry }, 429);
    }
    return true;
  }
}

@Global()
@Module({
  providers: [
    { provide: LOGGER, useFactory: (): Logger => createLogger({ service: process.env.SERVICE_NAME ?? 'api' }) },
    { provide: RATE_CONFIG, useFactory: (): RateConfig => rateConfigFromEnv() },
    { provide: RATE_STORE, inject: [LOGGER], useFactory: (log: Logger): RateStore => rateStoreFromEnv(process.env, (e) => log.warn('rate store unavailable, failing open', { error: String((e as Error)?.message ?? e) })) },
  ],
  exports: [LOGGER, RATE_CONFIG, RATE_STORE],
})
export class HardeningModule {}
