'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, getToken, logout, openStream, refresh } from '../../lib/api';
import { KIND_LABEL } from '../../lib/format';
import { OutcomeSheet, type Outcome, type SheetTarget, type Suggestion } from '../../components/OutcomeSheet';

interface Item { kind: string; leadId: string; leadName: string; reason: string; taskId?: string; callSessionId?: string; dueAt?: string; suggestedAction: { type: string } }
interface Queue { items: Item[]; counts: Record<string, number>; total: number; caughtUp: boolean }
interface Goal { gamification: boolean; goal?: number; done?: number; streakDays?: number }
interface Dialing { callSessionId: string; leadId: string; leadName: string; mode: 'cloud' | 'tap'; dialUri?: string }

/** Hands the number to the phone's dialer. Overridable seam so browser tests (which have no dialer) can stub it. */
function openDialer(uri: string) {
  const custom = (window as unknown as { __leaddeskOpenDialer?: (u: string) => void }).__leaddeskOpenDialer;
  try { if (custom) custom(uri); else window.location.assign(uri); } catch { /* the visible "Open dialer again" link is the fallback */ }
}

const LIVE_TEXT: Record<string, string> = {
  'lead.assigned': 'New lead assigned to you', 'message.in': 'A lead replied', 'task.created': 'Follow-up scheduled', 'task.due': 'A follow-up is due now',
  'task.missed': 'A follow-up was missed', 'task.escalated': 'A missed follow-up was escalated', 'sla.breached': 'A lead was reassigned: claim window passed',
  'lead.unclaimed': 'A lead went unclaimed', 'connection.degraded': 'A lead source needs attention', 'connection.failing': 'A lead source is failing', 'connection.revoked': 'A lead source was disconnected',
};

export default function Today() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [queue, setQueue] = useState<Queue | null>(null); const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [live, setLive] = useState(false); const [toast, setToast] = useState<string | null>(null);
  const [dialing, setDialing] = useState<Dialing | null>(null); const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const [suggest, setSuggest] = useState<(Suggestion & { leadId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string>('agent'); const [goal, setGoal] = useState<Goal | null>(null);
  const dialingRef = useRef<Dialing | null>(null); dialingRef.current = dialing;

  const say = useCallback((m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 4000); }, []);
  const load = useCallback(async () => {
    try { setQueue(await api<Queue>('/v1/do/queue')); setError(null); void api<Goal>('/v1/pulse/me').then(setGoal).catch(() => undefined); } // the goal ring never delays the list
    catch (e) { if (e instanceof ApiError && e.status === 401) router.replace('/login'); else setError('Could not load your leads. Retrying…'); }
  }, [router]);

  // boot: restore the session from the refresh cookie, then load data
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken() && !(await refresh())) { router.replace('/login'); return; } // arriving from the login screen already has a token
      if (!alive) return;
      setReady(true);
      // everything the first screen needs is fetched in parallel, the queue first
      const q = load();
      void api<Outcome[]>('/v1/outcomes').then(setOutcomes).catch(() => undefined);
      void api<{ role: string }>('/v1/me').then((m) => setRole(m.role)).catch(() => undefined);
      await q;
    })();
    return () => { alive = false; };
  }, [router, load]);

  // realtime + safety-net polling + presence heartbeat
  useEffect(() => {
    if (!ready) return;
    const stop = openStream((type, data) => {
      if (type === 'call.ended') { // cloud call finished: the system-verified duration arrives with the event
        const d = dialingRef.current;
        if (d && d.callSessionId === data?.callSessionId) { setDialing(null); setSheet({ leadId: d.leadId, leadName: d.leadName, callSessionId: d.callSessionId, durationS: data.durationS }); }
        void load(); return;
      }
      if (LIVE_TEXT[type]) { say(LIVE_TEXT[type]); void load(); }
    }, setLive);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    const beat = () => void api('/v1/me/presence', { method: 'PUT', body: { state: document.visibilityState === 'visible' ? 'online' : 'away' } }).catch(() => undefined);
    beat(); const hb = setInterval(beat, 60_000);
    const onVis = () => {
      beat();
      if (document.visibilityState === 'visible' && dialingRef.current?.mode === 'tap') void finishCall(); // back from the dialer: open the outcome sheet
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); clearInterval(poll); clearInterval(hb); document.removeEventListener('visibilitychange', onVis); };
  }, [ready]);

  async function call(item: Item) {
    setError(null);
    try {
      const r = await api<{ mode: 'cloud' | 'tap'; callSessionId: string; dialUri?: string }>('/v1/calls', { method: 'POST', body: { leadId: item.leadId } });
      setDialing({ ...r, leadId: item.leadId, leadName: item.leadName });
      if (r.mode === 'tap' && r.dialUri) openDialer(r.dialUri); // cloud: the platform rings the agent's phone, nothing to open
    } catch (e) {
      if (e instanceof ApiError && e.code === 'outcome_pending') { void load(); setError('Log your previous call first.'); }
      else setError(e instanceof ApiError ? e.message : 'Could not start the call');
    }
  }

  async function finishCall() {
    const d = dialingRef.current; if (!d) return;
    try {
      const r = await api<{ suggestedDurationS: number }>(`/v1/calls/${d.callSessionId}/end`, { method: 'POST', body: {} });
      setDialing(null); setSheet({ leadId: d.leadId, leadName: d.leadName, callSessionId: d.callSessionId, durationS: r.suggestedDurationS });
    } catch { setDialing(null); await load(); }
  }

  async function claim(item: Item) {
    try { await api(`/v1/leads/${item.leadId}/claim`, { method: 'POST' }); say('Claimed'); }
    catch (e) { say(e instanceof ApiError ? e.message : 'Could not claim'); }
  }

  async function applySuggestion() {
    if (!suggest?.statusId) return;
    try { await api(`/v1/leads/${suggest.leadId}/status`, { method: 'POST', body: { statusId: suggest.statusId, lostReasonId: suggest.lostReasonId ?? undefined } }); say('Status updated'); }
    catch (e) { say(e instanceof ApiError ? e.message : 'Could not update status'); }
    setSuggest(null); await load();
  }

  const cur = queue?.items[0];
  const upNext = queue?.items.slice(1, 8) ?? [];

  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar">
        <h1>Today</h1>
        <div className="row" style={{ alignItems: 'center' }}>
          <span className={`pill${live ? ' live' : ''}`} aria-label={live ? 'Live updates on' : 'Live updates off'}>{live ? '● live' : '○ offline'}</span>
          {['owner', 'admin'].includes(role) && <button onClick={() => router.push('/ops')} style={{ minHeight: 36, padding: '0 12px' }}>Health</button>}
          {['owner', 'admin'].includes(role) && <button onClick={() => router.push('/ai')} style={{ minHeight: 36, padding: '0 12px' }}>AI</button>}
          {['owner', 'admin', 'manager'].includes(role) && <button onClick={() => router.push('/pulse')} style={{ minHeight: 36, padding: '0 12px' }}>Pulse</button>}
          <button onClick={async () => { await logout(); router.replace('/login'); }} style={{ minHeight: 36, padding: '0 12px' }}>Sign out</button>
        </div>
      </div>

      {error && <p className="err" role="alert">{error}</p>}
      {goal?.gamification && goal.goal ? (
        <p className="reason" data-testid="goal" aria-label="Daily goal">Today: {goal.done} / {goal.goal} actions{goal.streakDays ? ` · ${goal.streakDays}-day streak` : ''}</p>
      ) : null}

      {suggest && (
        <div className="card" role="status">
          <h2>Suggested next step</h2>
          <p className="reason">Based on that outcome, move this lead to the suggested status?</p>
          <div className="row"><button className="primary" onClick={applySuggestion}>Update status</button><button onClick={() => setSuggest(null)}>Not now</button></div>
        </div>
      )}

      {dialing?.mode === 'cloud' && (
        <div className="card" role="status" data-testid="cloud-call">
          <span className="kind">Calling</span>
          <div className="name">{dialing.leadName}</div>
          <p className="reason">Answer your phone — we connect you to the lead. The outcome sheet opens when the call ends.</p>
        </div>
      )}

      {dialing?.mode === 'tap' && (
        <div className="card" role="status">
          <span className="kind">On a call</span>
          <div className="name">{dialing.leadName}</div>
          <p className="reason">Finish the call, then come back here. The outcome sheet opens automatically.</p>
          <div className="row">
            <button className="primary big" onClick={finishCall}>Call finished</button>
            <a className="btn" data-testid="dial-link" href={dialing.dialUri ?? '#'} style={{ display: 'inline-flex', alignItems: 'center' }}>Open dialer again</a>
          </div>
        </div>
      )}

      {!dialing && queue && queue.caughtUp && (
        <div className="card empty"><div className="tick" aria-hidden>✓</div><h2>All caught up</h2><p className="reason">New leads and follow-ups will appear here the moment they arrive.</p></div>
      )}

      {!dialing && cur && (
        <div className="card" aria-live="polite" data-testid="current-item">
          <span className="kind">{KIND_LABEL[cur.kind] ?? cur.kind}</span>
          <div className="name">{cur.leadName}</div>
          <p className="reason">{cur.reason}</p>
          <div className="row">
            {cur.kind === 'inbound'
              ? <><button className="primary big" onClick={() => router.push(`/lead/${cur.leadId}`)}>Reply</button><button onClick={() => call(cur)}>Call</button></>
              : cur.kind === 'outcome_pending' && cur.callSessionId
              ? <button className="primary big" onClick={() => setSheet({ leadId: cur.leadId, leadName: cur.leadName, callSessionId: cur.callSessionId })}>Log outcome</button>
              : (<>
                  <button className="primary big" onClick={() => call(cur)}>Call</button>
                  {cur.kind === 'new_lead' && <button onClick={() => claim(cur)}>Claim</button>}
                  <button onClick={() => router.push(`/lead/${cur.leadId}`)}>Message</button>
                </>)}
          </div>
        </div>
      )}

      {!dialing && upNext.length > 0 && (
        <div className="card"><h2>Up next ({queue!.total - 1})</h2>
          <ul className="list">{upNext.map((i) => (<li key={`${i.kind}:${i.leadId}:${i.taskId ?? ''}`}><span>{i.leadName}</span><span>{i.reason}</span></li>))}</ul>
        </div>
      )}

      {sheet && (
        <OutcomeSheet target={sheet} outcomes={outcomes}
          onDone={(s) => { const t = sheet; setSheet(null); if (s.statusId) setSuggest({ ...s, leadId: t.leadId }); say('Saved'); void load(); }}
          onSkipped={(left) => { setSheet(null); say(`Skipped. ${left} skip${left === 1 ? '' : 's'} left today`); void load(); }}
          onCancel={() => setSheet(null)} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
