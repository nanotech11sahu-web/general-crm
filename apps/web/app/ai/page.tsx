'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

const FEATURES: [string, string, boolean][] = [
  ['assessment', 'New-lead assessment', true], ['summary', 'Lead summaries', true], ['autofill', 'Auto-fill fields', true], ['scoring', 'Lead scoring', true],
  ['next_action', 'Outcome + next action from notes', false], ['nl_search', 'Natural-language search', false], ['import_mapping', 'Smart import mapping', false],
];
interface Settings { enabled: boolean; killSwitch: boolean; dailyCap: number; features: Record<string, number> }
interface Usage { used: number; cap: number; features: { feature: string; requests: number; failures: number }[] }

/** Admin: switch AI on, per-feature level (off / suggest / auto for low-risk), daily cap, kill switch, today's usage. */
export default function AiSettings() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [s, setS] = useState<Settings | null>(null); const [u, setU] = useState<Usage | null>(null); const [msg, setMsg] = useState<string | null>(null); const [forbidden, setForbidden] = useState(false);
  const load = useCallback(async () => {
    try { setS(await api<Settings>('/v1/ai/settings')); setU(await api<Usage>('/v1/ai/usage').catch(() => null)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) router.replace('/login'); }
  }, [router]);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } const me = await api<{ role: string }>('/v1/me'); if (!['owner', 'admin'].includes(me.role)) setForbidden(true); setReady(true); await load(); })(); }, [router, load]);
  async function save(body: Record<string, unknown>) {
    setMsg(null);
    try { setS(await api<Settings>('/v1/ai/settings', { method: 'PUT', body })); setMsg('Saved'); await load(); }
    catch (e) { setMsg(e instanceof ApiError ? `${e.message}${e.details ? ': ' + Object.values(e.details).join('; ') : ''}` : 'Could not save'); }
  }
  if (!ready || !s) return <main><p className="reason">Loading…</p></main>;
  if (forbidden) return <main><p className="reason">AI settings are for admins and owners.</p></main>;
  return (
    <main>
      <div className="bar"><h1>AI</h1><button onClick={() => router.push('/today')} style={{ minHeight: 36, padding: '0 12px' }}>Today</button></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      <section className="card"><h2>Status</h2>
        <p className="reason">AI is optional and off by default. LeadDesk works fully without it. Connect Groq under Connections first. Lead text is sent to the provider with phone numbers and e-mails masked.</p>
        <div className="row">
          <button className={s.enabled ? '' : 'primary'} onClick={() => save({ enabled: !s.enabled })}>{s.enabled ? 'Switch AI off' : 'Switch AI on'}</button>
          <button className={s.killSwitch ? 'primary' : ''} onClick={() => save({ killSwitch: !s.killSwitch })}>{s.killSwitch ? 'Resume AI' : 'Pause everything (kill switch)'}</button>
        </div>
        {u && <p className="reason">Today: {u.used} / {u.cap} requests{u.features.length ? ` (${u.features.map((f) => `${f.feature} ${f.requests}`).join(', ')})` : ''}</p>}
        <label htmlFor="cap">Daily request cap</label>
        <input id="cap" type="number" min={0} defaultValue={s.dailyCap} onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n !== s.dailyCap) void save({ dailyCap: n }); }} />
      </section>
      <section className="card"><h2>Features</h2>
        {FEATURES.map(([key, label, canAuto]) => (
          <div key={key}><label htmlFor={`f-${key}`}>{label}</label>
            <select id={`f-${key}`} value={s.features[key] ?? 1} onChange={(e) => save({ features: { [key]: Number(e.target.value) } })}>
              <option value={0}>Off</option><option value={1}>Suggest (you accept)</option>{canAuto && <option value={2}>Auto-apply (low risk)</option>}
            </select></div>
        ))}
        <p className="reason">AI never contacts leads, and every automatic change is logged. Features that create work for people always need a tap.</p>
      </section>
    </main>
  );
}
