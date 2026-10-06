/**
 * Optional error tracking (Sentry-compatible). Inert unless SENTRY_DSN is set. Nothing about a customer may leave the platform:
 * no request bodies, headers, cookies, query strings or user objects, and phone numbers / e-mails inside messages are masked.
 */
export interface ErrorTracker { readonly enabled: boolean; capture(e: unknown, tags?: Record<string, string | number | boolean>): void; flush(timeoutMs?: number): Promise<void> }

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d[\s().-]?){8,}\d/g;
const TOKEN = /\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|gsk_[A-Za-z0-9]{10,}|[A-Za-z0-9_-]{32,})\b/g; // JWTs, provider keys, long opaque secrets
export const scrubText = (s: string) => s.replace(EMAIL, '[email]').replace(TOKEN, '[secret]').replace(PHONE, '[phone]');

/** Sentry `beforeSend`: strips everything request/user related and masks free text. Returning null drops the event. */
export function scrubEvent<T extends Record<string, any>>(ev: T): T | null {
  const e: any = { ...ev };
  delete e.request; delete e.user; delete e.server_name; delete e.extra; delete e.contexts?.device;
  if (typeof e.message === 'string') e.message = scrubText(e.message);
  if (e.exception?.values) e.exception = { values: e.exception.values.map((v: any) => ({ ...v, value: typeof v.value === 'string' ? scrubText(v.value) : v.value })) };
  if (e.breadcrumbs) e.breadcrumbs = [];
  return e;
}

const NOOP: ErrorTracker = { enabled: false, capture() { /* off */ }, async flush() { /* off */ } };
let current: ErrorTracker = NOOP;

/** `sdk` is injectable for tests; production loads @sentry/node lazily so installs without a DSN never touch it. */
export function initErrorTracking(service: string, env: NodeJS.ProcessEnv = process.env, sdk?: any): ErrorTracker {
  if (!env.SENTRY_DSN) return (current = NOOP);
  const s = sdk ?? require('@sentry/node'); // eslint-disable-line @typescript-eslint/no-require-imports
  s.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV ?? 'development', release: env.RELEASE, sendDefaultPii: false, tracesSampleRate: 0, maxBreadcrumbs: 0, beforeSend: scrubEvent, initialScope: { tags: { service } } });
  current = {
    enabled: true,
    capture(e, tags) { try { s.withScope((scope: any) => { for (const [k, v] of Object.entries(tags ?? {})) scope.setTag(k, String(v)); s.captureException(e); }); } catch { /* tracking must never break the app */ } },
    async flush(ms = 2000) { try { await s.flush(ms); } catch { /* ignore */ } },
  };
  return current;
}
/** Used by filters and workers without wiring: a no-op until initErrorTracking ran with a DSN. */
export const errorTracker = (): ErrorTracker => current;
