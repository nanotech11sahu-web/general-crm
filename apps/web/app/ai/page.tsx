'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

const FEATURES: [string, string, boolean][] = [
  ['assessment', 'New-lead assessment', true], ['summary', 'Lead summaries', true], ['autofill', 'Auto-fill fields', true], ['scoring', 'Lead scoring', true],
  ['reply_draft', 'Draft replies (you send them)', false], ['duplicate', 'Duplicate detection', false], ['inbound_intel', 'Read every new reply (runs in the background)', true], ['revival', 'Suggest re-engaging quiet leads (runs in the background)', false], ['autopilot', 'Qualification assistant: answers new WhatsApp chats and asks your checklist questions', false], ['insight', 'AI-written line in the daily digest (numbers only)', false], ['call_qa', 'Call transcription and review', false], ['next_action', 'Outcome + next action from notes', false], ['nl_search', 'Natural-language search', false], ['import_mapping', 'Smart import mapping', false],
];
interface Settings { enabled: boolean; killSwitch: boolean; dailyCap: number; features: Record<string, number>; scoringGuidance?: string; revivalDays?: number; callAnalysisConsent?: boolean }
interface Review { callId: string; leadId: string; startedAt: string; durationS?: number; status: string; score: number | null; summary: string | null; flags: string[]; coaching: string | null }
interface Auto { checklist: { key: string; question: string }[]; maxMessages: number; graceSeconds: number; holdingMessage: string }
interface Kb { _id: string; title: string; text: string; active: boolean }
interface Usage { used: number; cap: number; features: { feature: string; requests: number; failures: number }[] }

/** Admin: switch AI on, per-feature level (off / suggest / auto for low-risk), daily cap, kill switch, today's usage. */
export default function AiSettings() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [s, setS] = useState<Settings | null>(null); const [u, setU] = useState<Usage | null>(null); const [msg, setMsg] = useState<string | null>(null); const [forbidden, setForbidden] = useState(false);
  const [auto, setAuto] = useState<Auto | null>(null); const [reviews, setReviews] = useState<Review[]>([]); const [kb, setKb] = useState<Kb[]>([]); const [nk, setNk] = useState({ title: '', text: '' });
  const load = useCallback(async () => {
    try { setS(await api<Settings>('/v1/ai/settings')); setU(await api<Usage>('/v1/ai/usage').catch(() => null)); setKb(await api<Kb[]>('/v1/ai/knowledge').catch(() => [])); setReviews(await api<Review[]>('/v1/ai/call-reviews').catch(() => [])); setAuto(await api<Auto>('/v1/ai/autopilot').catch(() => null)); }
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
      <div className="bar"><h1>AI</h1></div>
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
        <p className="reason">AI never contacts leads, and every automatic change is logged. Features that create work for people always need a tap. Background features start off.</p>
        <label htmlFor="guide">What makes a good lead for you? (used when scoring)</label>
        <textarea id="guide" maxLength={600} defaultValue={s.scoringGuidance ?? ''} placeholder="e.g. Budget above 80 lakh is hot. Leads from referrals are warmer than portals." onBlur={(e) => { if (e.target.value !== (s.scoringGuidance ?? '')) void save({ scoringGuidance: e.target.value }); }} />
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 15, color: 'inherit' }}><input type="checkbox" data-testid="call-consent" style={{ width: 20, minHeight: 20, marginTop: 2 }} checked={!!s.callAnalysisConsent} onChange={(e) => save({ callAnalysisConsent: e.target.checked })} />
          <span>I confirm that people on recorded calls are told they are recorded, and I agree that call recordings are sent to my AI provider for transcription and review. (Needed before call review can run.)</span></label>
        <label htmlFor="rev">Call a lead “quiet” after (days)</label>
        <input id="rev" type="number" min={7} max={90} defaultValue={s.revivalDays ?? 14} onBlur={(e) => { const n = Number(e.target.value); if (n !== s.revivalDays) void save({ revivalDays: n }); }} />
      </section>
      {auto && (<section className="card" data-testid="autopilot"><h2>Qualification assistant</h2>
        <p className="reason">When a lead writes to you on WhatsApp and nobody replies within {Math.round(auto.graceSeconds / 60 * 10) / 10} min, the assistant answers from your knowledge base, asks the questions below one by one, then hands over with a task for the owner. It never starts a chat, never talks price, hands off on complaints or requests for a person, and stops the moment someone on your team replies. Switch it on under Features once a checklist exists.</p>
        {auto.checklist.map((c, i) => (<div key={i} className="row" style={{ marginBottom: 6 }}><input aria-label={`Checklist key ${i + 1}`} value={c.key} onChange={(e) => setAuto({ ...auto, checklist: auto.checklist.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)) })} style={{ flex: 1 }} /><input aria-label={`Checklist question ${i + 1}`} value={c.question} onChange={(e) => setAuto({ ...auto, checklist: auto.checklist.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)) })} style={{ flex: 3 }} /><button style={{ minHeight: 40, padding: '0 10px' }} onClick={() => setAuto({ ...auto, checklist: auto.checklist.filter((_, k) => k !== i) })}>Remove</button></div>))}
        <div className="row"><button onClick={() => setAuto({ ...auto, checklist: [...auto.checklist, { key: '', question: '' }] })} disabled={auto.checklist.length >= 6}>Add question</button></div>
        <label htmlFor="apmax">Most messages it may send per chat</label><input id="apmax" type="number" min={1} max={6} value={auto.maxMessages} onChange={(e) => setAuto({ ...auto, maxMessages: Number(e.target.value) })} />
        <label htmlFor="apgrace">Wait for a person first (seconds)</label><input id="apgrace" type="number" min={30} max={1800} value={auto.graceSeconds} onChange={(e) => setAuto({ ...auto, graceSeconds: Number(e.target.value) })} />
        <label htmlFor="aphold">Message when it hands over</label><input id="aphold" maxLength={200} value={auto.holdingMessage} onChange={(e) => setAuto({ ...auto, holdingMessage: e.target.value })} />
        <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={async () => { try { setAuto(await api<Auto>('/v1/ai/autopilot', { method: 'PUT', body: auto })); setMsg('Saved'); } catch (e) { setMsg(e instanceof ApiError ? `${e.message}${e.details ? ': ' + Object.values(e.details).join('; ') : ''}` : 'Could not save'); } }}>Save</button></div></section>)}
      {reviews.length > 0 && (<section className="card" data-testid="call-reviews"><h2>Call reviews</h2>
        <ul className="list">{reviews.map((r) => (<li key={r.callId} style={{ display: 'block' }}><b>{r.score !== null ? `${r.score}/100` : r.status}</b> · {new Date(r.startedAt).toLocaleString()}{r.durationS ? ` · ${Math.round(r.durationS / 60)} min` : ''}<br /><span className="reason">{r.summary}</span>{r.coaching && <><br /><span className="reason">Coaching: {r.coaching}</span></>}{r.flags.length > 0 && <p className="err">{r.flags.join(' · ')}</p>}
          <button style={{ minHeight: 32, padding: '0 10px', marginTop: 6 }} onClick={async () => { const a = await api<{ transcript?: string }>(`/v1/ai/calls/${r.callId}/analysis`); window.alert(a.transcript ?? 'The transcript has expired with the recording.'); }}>Read transcript</button></li>))}</ul></section>)}
      <section className="card" data-testid="knowledge"><h2>Knowledge base</h2>
        <p className="reason">Facts the reply drafter may use: projects, prices, timings, FAQs. It is told to use nothing else, and figures it invents are flagged before you send.</p>
        <ul className="list">{kb.map((k) => (<li key={k._id}><span><b>{k.title}</b><br /><span className="reason">{k.text.slice(0, 120)}{k.text.length > 120 ? '…' : ''}</span></span><span><button style={{ minHeight: 32, padding: '0 10px' }} onClick={async () => { await api(`/v1/ai/knowledge/${k._id}`, { method: 'DELETE' }); await load(); }}>Delete</button></span></li>))}</ul>
        <form onSubmit={async (e) => { e.preventDefault(); try { await api('/v1/ai/knowledge', { method: 'POST', body: nk }); setNk({ title: '', text: '' }); setMsg('Added'); await load(); } catch (er) { setMsg(er instanceof ApiError ? er.message : 'Could not save'); } }}>
          <label htmlFor="kt">Title</label><input id="kt" required maxLength={120} value={nk.title} onChange={(e) => setNk({ ...nk, title: e.target.value })} />
          <label htmlFor="kx">What should it know?</label><textarea id="kx" required minLength={5} maxLength={2000} value={nk.text} onChange={(e) => setNk({ ...nk, text: e.target.value })} />
          <div className="row" style={{ marginTop: 8 }}><button className="primary">Add entry</button></div></form>
      </section>
    </main>
  );
}
