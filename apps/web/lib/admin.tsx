'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from './api';

/** Session guard for admin pages: refreshes the token, redirects to /login, exposes a message line and a safe action runner. */
export function useAdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setReady(true); })(); }, [router]);
  const explain = (e: unknown) => e instanceof ApiError ? `${e.message}${e.details ? ': ' + Object.values(e.details).join('; ') : ''}` : 'Something went wrong';
  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => { setMsg(null); try { await fn(); if (ok) setMsg(ok); return true; } catch (e) { setMsg(explain(e)); return false; } }, []);
  return { router, ready, msg, setMsg, run };
}

/** Loads a resource once and on demand; 403 becomes an empty value plus a flag instead of a crash. */
export function useResource<T>(path: string, empty: T, enabled = true) {
  const [data, setData] = useState<T>(empty); const [denied, setDenied] = useState(false);
  const reload = useCallback(async () => { try { setData(await api<T>(path)); setDenied(false); } catch (e) { if (e instanceof ApiError && e.status === 403) setDenied(true); } }, [path]);
  useEffect(() => { if (enabled) void reload(); }, [reload, enabled]);
  return { data, denied, reload };
}

export interface Member { userId: string; role: string; status: string; teamId: string | null; name?: string; email?: string }
export const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
