'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

interface Health {
  connections: { total: number; byStatus: Record<string, number>; unhealthy: { id: string; name: string; provider: string; status: string; lastError: string | null }[] };
  webhooks: { pending: number; failed: number; dead: number; deadLast24h: number; oldestPendingS: number; processingLatencyS: { p50: number | null; p95: number | null; samples: number } };
  sends: { last24h: number; failed: number; failureRate: number };
  timers: { claimTimersOverdue: number; tasksNotSwept: number };
  outbox: { backlog: number; oldestS: number };
  alerts: { rule: string; severity: 'warning' | 'critical'; text: string }[];
}
const mins = (s: number) => (s < 90 ? `${s}s` : `${Math.round(s / 60)} min`);

/** Admin: is the lead pipeline healthy for this workspace? Same numbers the alert rules use. */
export default function OpsHealth() {
  const router = useRouter();
  const [h, setH] = useState<Health | null>(null); const [ready, setReady] = useState(false); const [forbidden, setForbidden] = useState(false);
  const load = useCallback(async () => {
    try { setH(await api<Health>('/v1/ops/health')); } catch (e) { if (e instanceof ApiError && e.status === 403) setForbidden(true); else if (e instanceof ApiError && e.status === 401) router.replace('/login'); }
  }, [router]);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setReady(true); await load(); })(); }, [router, load]);
  useEffect(() => { if (!ready) return; const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000); return () => clearInterval(t); }, [ready, load]);
  if (forbidden) return <main><p className="reason" role="alert">Workspace health is for admins and owners.</p></main>;
  if (!h) return <main><p className="reason">Loading…</p></main>;
  const good = h.alerts.length === 0;
  return (
    <main>
      <div className="bar"><h1>Health</h1></div>
      <section className="card" aria-label="Overall" data-testid="overall"><h2>{good ? '✓ Everything is flowing' : `${h.alerts.length} thing${h.alerts.length === 1 ? '' : 's'} need attention`}</h2>
        {!good && <ul className="list">{h.alerts.map((a) => <li key={a.rule} data-severity={a.severity}><span>{a.severity === 'critical' ? '🔴' : '🟠'} {a.text}</span></li>)}</ul>}
      </section>
      <section className="card" aria-label="Lead sources"><h2>Connections</h2>
        <p className="reason">{h.connections.total === 0 ? 'No connections yet.' : Object.entries(h.connections.byStatus).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>
        {h.connections.unhealthy.map((c) => <p key={c.id} className="reason">{c.name} ({c.provider}): {c.status}{c.lastError ? ` — ${c.lastError}` : ''}</p>)}
      </section>
      <section className="card" aria-label="Incoming events"><h2>Incoming events</h2>
        <p className="reason">{h.webhooks.pending} waiting{h.webhooks.pending ? ` (oldest ${mins(h.webhooks.oldestPendingS)})` : ''} · {h.webhooks.failed} retrying · {h.webhooks.dead} failed permanently</p>
        <p className="reason">Processing time: median {h.webhooks.processingLatencyS.p50 === null ? '–' : `${h.webhooks.processingLatencyS.p50}s`}, slowest 5% {h.webhooks.processingLatencyS.p95 === null ? '–' : `${h.webhooks.processingLatencyS.p95}s`}</p>
      </section>
      <section className="card" aria-label="Messages and timers"><h2>Messages and timers</h2>
        <p className="reason">{h.sends.last24h} messages in 24 h, {h.sends.failed} failed ({Math.round(h.sends.failureRate * 100)}%)</p>
        <p className="reason">Late claim timers: {h.timers.claimTimersOverdue} · tasks not yet swept: {h.timers.tasksNotSwept} · outbox backlog: {h.outbox.backlog}</p>
      </section>
    </main>
  );
}
