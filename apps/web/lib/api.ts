/** Tiny API client: access token lives in memory; the refresh token is an httpOnly cookie. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string>) { super(message); }
}

let token: string | null = null;
let refreshing: Promise<boolean> | null = null;
export const getToken = () => token;
export const setToken = (t: string | null) => { token = t; };

export async function refresh(): Promise<boolean> {
  refreshing ??= fetch('/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then(async (r) => { if (!r.ok) return false; token = (await r.json()).accessToken; return true; })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, retry = true): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET', credentials: 'same-origin',
    headers: { ...(init.headers ?? {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && retry && (await refresh())) return api<T>(path, init, false);
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (res.status === 403 && body.code === 'two_factor_required' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/security')) { window.location.assign('/security?required=1'); } // the workspace needs this person to set up two-factor first
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'error', Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText, body.details);
  return body as T;
}

export async function login(email: string, password: string, totp?: string, passkey?: { challengeToken: string; response: unknown }) {
  const r = await api<{ accessToken: string }>('/v1/auth/login', { method: 'POST', body: { email, password, ...(totp ? { totp } : {}), ...(passkey ? { passkey } : {}) } }, false);
  token = r.accessToken;
}
export async function logout() { await fetch('/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined); token = null; }

/**
 * Server-Sent Events over fetch (EventSource cannot send an Authorization header).
 * Reconnects with backoff and Last-Event-ID so nothing is missed while offline.
 */
export function openStream(onEvent: (type: string, data: any) => void, onState?: (live: boolean) => void) {
  let stop = false; let lastId: string | undefined; let ctrl: AbortController | undefined; let delay = 1000;
  const run = async () => {
    while (!stop) {
      ctrl = new AbortController();
      try {
        const res = await fetch('/v1/stream', { headers: { accept: 'text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(lastId ? { 'last-event-id': lastId } : {}) }, signal: ctrl.signal, credentials: 'same-origin' });
        if (res.status === 401 && (await refresh())) continue;
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        onState?.(true); delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          for (let i = buf.indexOf('\n\n'); i >= 0; i = buf.indexOf('\n\n')) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            let type = 'message', data = ''; let id: string | undefined;
            for (const line of block.split('\n')) { if (line.startsWith('event:')) type = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); else if (line.startsWith('id:')) id = line.slice(3).trim(); }
            if (id && id !== '0') lastId = id;
            if (type !== 'ping') { try { onEvent(type, data ? JSON.parse(data) : {}); } catch { /* ignore malformed */ } }
          }
        }
      } catch { /* fall through to retry */ }
      onState?.(false);
      if (stop) return;
      await new Promise((r) => setTimeout(r, delay)); delay = Math.min(delay * 2, 30_000);
    }
  };
  void run();
  return () => { stop = true; ctrl?.abort(); };
}
