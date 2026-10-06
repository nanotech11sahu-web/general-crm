import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorTracker, initErrorTracking, scrubEvent, scrubText } from '../src';

describe('error tracking', () => {
  afterEach(() => { initErrorTracking('t', {} as any); });
  it('is inert without a DSN (nothing is loaded, capture is a no-op)', () => {
    const t = initErrorTracking('api', {} as any); expect(t.enabled).toBe(false); expect(() => t.capture(new Error('x'))).not.toThrow(); expect(errorTracker()).toBe(t);
  });
  it('scrubs request data, users, contacts and secrets from events', () => {
    const ev = scrubEvent({ message: 'failed for asha@x.co on +91 98123 45678 with key gsk_abcdefghij1234567890', request: { headers: { authorization: 'Bearer abc' }, data: { password: 'p' }, cookies: 'a=b' }, user: { email: 'asha@x.co' }, extra: { body: 'x' }, breadcrumbs: [{ message: 'GET /v1/leads' }], exception: { values: [{ type: 'Error', value: 'cannot reach 9812345678 or bob@y.io' }] } })!;
    expect(ev.request).toBeUndefined(); expect(ev.user).toBeUndefined(); expect(ev.extra).toBeUndefined(); expect(ev.breadcrumbs).toEqual([]);
    expect(ev.message).toBe('failed for [email] on [phone] with key [secret]'); expect(ev.exception.values[0].value).toBe('cannot reach [phone] or [email]');
    expect(scrubText('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk ok')).toBe('token [secret] ok');
    expect(scrubText('3 BHK at 80 lakh')).toBe('3 BHK at 80 lakh'); // ordinary text is untouched
  });
  it('initialises the SDK with privacy settings and tags, and capture never throws even if the SDK does', () => {
    const calls: any[] = []; const scope = { setTag: (k: string, v: string) => calls.push(['tag', k, v]) };
    const sdk = { init: (o: any) => calls.push(['init', o]), withScope: (fn: any) => fn(scope), captureException: (e: any) => calls.push(['capture', String(e)]), flush: async () => true };
    const t = initErrorTracking('worker', { SENTRY_DSN: 'https://k@o.ingest.sentry.io/1', NODE_ENV: 'production' } as any, sdk);
    expect(t.enabled).toBe(true); const init = calls[0][1];
    expect(init).toMatchObject({ dsn: 'https://k@o.ingest.sentry.io/1', sendDefaultPii: false, tracesSampleRate: 0, maxBreadcrumbs: 0, environment: 'production', initialScope: { tags: { service: 'worker' } } }); expect(init.beforeSend).toBe(scrubEvent);
    t.capture(new Error('boom'), { job: 'ai' }); expect(calls).toContainEqual(['tag', 'job', 'ai']); expect(calls).toContainEqual(['capture', 'Error: boom']);
    const bad = { ...sdk, captureException: vi.fn(() => { throw new Error('sdk down'); }) }; const t2 = initErrorTracking('api', { SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as any, bad); expect(() => t2.capture(new Error('x'))).not.toThrow();
  });
});
