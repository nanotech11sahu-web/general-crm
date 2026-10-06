/**
 * Hardened outbound HTTP for connectors (spec §8): fixed allow-listed hosts (so a hostile
 * paging URL can't pivot to internal addresses), timeouts, bounded retries and body size.
 */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer>; headers?: { get(name: string): string | null } }>;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: any) { super(message); this.name = 'HttpError'; }
  get retryable() { return this.status === 429 || this.status >= 500 || this.status === 0; }
}

export interface HttpOptions { fetch?: FetchLike; allowedHosts: string[]; /** Also allow any host ending in one of these (e.g. '.exotel.com'). */ allowedSuffixes?: string[]; timeoutMs?: number; maxBytes?: number; retries?: number }

export function createHttp(o: HttpOptions) {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i as any) as any);
  const timeoutMs = o.timeoutMs ?? 10_000, maxBytes = o.maxBytes ?? 2_000_000, retries = o.retries ?? 2;
  const assertAllowed = (u: URL) => {
    const ok = u.protocol === 'https:' && (o.allowedHosts.includes(u.hostname) || (o.allowedSuffixes ?? []).some((x) => u.hostname.endsWith(x)));
    if (!ok) throw new HttpError(0, `Blocked outbound request to ${u.hostname}`);
  };
  return {
    /** Binary download (recordings): same allow-list, hard size cap, no redirects to other hosts (fetch follows only same policy via caller). */
    async bytes(url: string, init: { headers?: Record<string, string>; maxBytes?: number } = {}): Promise<{ bytes: Buffer; contentType: string }> {
      assertAllowed(new URL(url));
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), Math.max(timeoutMs, 30_000));
      try {
        const res = await doFetch(url, { headers: init.headers, signal: ac.signal });
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
        if (!res.arrayBuffer) throw new HttpError(0, 'Binary responses are not supported by this fetch');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > (init.maxBytes ?? 25_000_000)) throw new HttpError(res.status, 'Recording too large');
        return { bytes: buf, contentType: res.headers?.get('content-type') ?? 'audio/mpeg' };
      } catch (e: any) { throw e instanceof HttpError ? e : new HttpError(0, e?.name === 'AbortError' ? 'Download timed out' : String(e?.message ?? e)); }
      finally { clearTimeout(timer); }
    },
    async json<T = any>(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<T> {
      const u = new URL(url);
      assertAllowed(u);
      let last: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        try {
          const res = await doFetch(url, { ...init, signal: ac.signal });
          const text = await res.text();
          if (text.length > maxBytes) throw new HttpError(res.status, 'Response too large');
          let body: any; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
          if (!res.ok) throw new HttpError(res.status, body?.error?.message ?? `HTTP ${res.status}`, body);
          return body as T;
        } catch (e: any) {
          last = e instanceof HttpError ? e : new HttpError(0, e?.name === 'AbortError' ? 'Request timed out' : String(e?.message ?? e));
          if (!(last as HttpError).retryable || attempt === retries) throw last;
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        } finally { clearTimeout(timer); }
      }
      throw last;
    },
  };
}
export type Http = ReturnType<typeof createHttp>;
