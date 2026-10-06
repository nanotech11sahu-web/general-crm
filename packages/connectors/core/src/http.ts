/**
 * Hardened outbound HTTP for connectors (spec §8): fixed allow-listed hosts (so a hostile
 * paging URL can't pivot to internal addresses), timeouts, bounded retries and body size.
 */
export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly body?: any) { super(message); this.name = 'HttpError'; }
  get retryable() { return this.status === 429 || this.status >= 500 || this.status === 0; }
}

export interface HttpOptions { fetch?: FetchLike; allowedHosts: string[]; timeoutMs?: number; maxBytes?: number; retries?: number }

export function createHttp(o: HttpOptions) {
  const doFetch: FetchLike = o.fetch ?? ((u, i) => fetch(u, i as any) as any);
  const timeoutMs = o.timeoutMs ?? 10_000, maxBytes = o.maxBytes ?? 2_000_000, retries = o.retries ?? 2;
  return {
    async json<T = any>(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<T> {
      const u = new URL(url);
      if (u.protocol !== 'https:' || !o.allowedHosts.includes(u.hostname)) throw new HttpError(0, `Blocked outbound request to ${u.hostname}`);
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
