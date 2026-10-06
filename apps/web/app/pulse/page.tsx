'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

type Range = 'today' | '7d' | '30d';
interface Metrics { responseMedianS: number | null; withinSlaPct: number | null; connectRate: number | null; avgTalkS: number | null; conversionPct: number | null; followUpPct: number | null }
interface Kpis { metrics: Metrics; counts: Record<string, number>; trendPct: Record<string, number | null>; verifiedCallShare: number | null }
interface Member { userId: string; name: string; presence: string; overdue: number; awaitingFirstContact: number; openLeads: number }
interface Team { members: Member[]; summary: Record<string, number>; totalOverdue: number; unassignedAwaitingFirstContact: number }
interface Bucket { count: number; leads: { leadId: string; name: string }[] }
interface Leakage { untouched: Bucket & { thresholdHours: number }; abandoned: Bucket & { thresholdDays: number }; lateFirstContact: Bucket; missedFollowUps: Bucket }
interface SourceRow { name: string; leads: number; contactedPct: number | null; qualifiedPct: number | null; wonPct: number | null; responseMedianS: number | null }
interface AgentRow { userId: string; name: string; responseMedianS: number | null; connectRate: number | null; followUpPct: number | null; outcomeSkips: number; conversionPct: number | null; verifiedCallShare: number | null }
interface Insight { id: string; severity: 'high' | 'medium' | 'info'; text: string }

const dur = (s: number | null) => (s === null ? '–' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
const p = (v: number | null) => (v === null ? '–' : `${v}%`);
const arrow = (v: number | null | undefined, goodWhenUp: boolean) => { if (v === null || v === undefined || v === 0) return null; const up = v > 0; return <span className={up === goodWhenUp ? 'trend good' : 'trend bad'} style={{ fontSize: 12, marginLeft: 6, color: up === goodWhenUp ? '#15803d' : '#b91c1c' }}>{up ? '▲' : '▼'} {Math.abs(v)}%</span>; };
const PRESENCE: Record<string, string> = { online: '● online', on_call: '☎ on a call', away: '◐ away', offline: '○ offline' };

/** Manager home: five KPIs, live team board, leakage with one-click reassign, source quality, scorecards, insights. */
export default function Pulse() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [forbidden, setForbidden] = useState(false);
  const [range, setRange] = useState<Range>('7d');
  const [kpis, setKpis] = useState<Kpis | null>(null); const [team, setTeam] = useState<Team | null>(null); const [leak, setLeak] = useState<Leakage | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]); const [agents, setAgents] = useState<AgentRow[]>([]); const [insights, setInsights] = useState<Insight[]>([]);
  const [assignee, setAssignee] = useState(''); const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [k, t, l, s, a, i] = await Promise.all([
        api<Kpis>(`/v1/pulse/kpis?range=${range}`), api<Team>('/v1/pulse/team'), api<Leakage>('/v1/pulse/leakage'),
        api<{ rows: SourceRow[] }>(`/v1/pulse/sources?range=${range === 'today' ? '7d' : range}`), api<{ rows: AgentRow[] }>(`/v1/pulse/agents?range=${range}`), api<Insight[]>('/v1/pulse/insights'),
      ]);
      setKpis(k); setTeam(t); setLeak(l); setSources(s.rows); setAgents(a.rows); setInsights(i); setForbidden(false);
    } catch (e) { if (e instanceof ApiError && e.status === 403) setForbidden(true); else if (e instanceof ApiError && e.status === 401) router.replace('/login'); else setMsg('Could not load Pulse. Retrying…'); }
  }, [range, router]);

  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setReady(true); })(); }, [router]);
  useEffect(() => { if (!ready) return; void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000); return () => clearInterval(t); }, [ready, load]);

  async function reassign(b: Bucket, label: string) {
    if (!assignee) { setMsg('Pick who should get these leads first.'); return; }
    try { const r = await api<{ updated: number }>('/v1/leads/bulk', { method: 'POST', body: { ids: b.leads.map((l) => l.leadId), action: 'assign', ownerId: assignee } }); setMsg(`${r.updated} ${label} lead${r.updated === 1 ? '' : 's'} reassigned`); await load(); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not reassign'); }
  }

  if (!ready) return <main><p className="reason">Loading…</p></main>;
  if (forbidden) return <main><div className="bar"><h1>Pulse</h1><button onClick={() => router.push('/today')}>Back</button></div><p className="reason" role="alert">Pulse is for managers and owners.</p></main>;
  const m = kpis?.metrics;
  const tiles: [string, string, string, boolean][] = m && kpis ? [
    ['Response time', dur(m.responseMedianS), `${p(m.withinSlaPct)} within SLA`, false], ['Connect rate', p(m.connectRate), `${kpis.counts.connected}/${kpis.counts.calls} calls`, true],
    ['Avg talk time', dur(m.avgTalkS), kpis.verifiedCallShare === null ? '' : `${kpis.verifiedCallShare}% verified`, true], ['Conversion', p(m.conversionPct), `${kpis.counts.won}/${kpis.counts.leads} leads`, true],
    ['Follow-ups on time', p(m.followUpPct), `${kpis.counts.tasksOnTime}/${kpis.counts.tasksDue} due`, true],
  ] : [];
  const trendKey = ['responseMedianS', 'connectRate', 'avgTalkS', 'conversionPct', 'followUpPct'];

  return (
    <main style={{ maxWidth: 960 }}>
      <div className="bar"><h1>Pulse</h1><div className="row"><button onClick={() => router.push('/today')} style={{ minHeight: 36, padding: '0 12px' }}>Today</button></div></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      <div className="row" role="tablist" aria-label="Period">
        {(['today', '7d', '30d'] as Range[]).map((r) => <button key={r} role="tab" aria-selected={range === r} className={range === r ? 'primary' : ''} onClick={() => setRange(r)}>{r === 'today' ? 'Today' : r === '7d' ? '7 days' : '30 days'}</button>)}
      </div>

      {insights.length > 0 && (
        <section className="card" aria-label="Insights"><h2>Needs attention</h2>
          <ul className="list">{insights.map((i) => <li key={i.id} data-severity={i.severity}><span>{i.severity === 'high' ? '🔴' : i.severity === 'medium' ? '🟠' : 'ℹ️'} {i.text}</span></li>)}</ul>
        </section>
      )}

      <section aria-label="Key numbers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        {tiles.map(([label, value, sub, up], i) => (
          <div className="card" key={label} data-testid={`kpi-${trendKey[i]}`}><span className="kind">{label}</span><div className="name">{value}{arrow(kpis!.trendPct[trendKey[i]], up)}</div><p className="reason">{sub}</p></div>
        ))}
      </section>

      {team && (
        <section className="card" aria-label="Team board"><h2>Team now</h2>
          <p className="reason">{team.summary.online} online · {team.summary.onCall} on a call · {team.summary.idle} away · {team.summary.offline} offline · {team.totalOverdue} overdue{team.unassignedAwaitingFirstContact ? ` · ${team.unassignedAwaitingFirstContact} unassigned waiting` : ''}</p>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 14 }}><thead><tr><th align="left">Agent</th><th align="left">Status</th><th>Overdue</th><th>Waiting</th><th>Open</th></tr></thead>
            <tbody>{team.members.map((x) => <tr key={x.userId}><td>{x.name}</td><td>{PRESENCE[x.presence] ?? x.presence}</td><td align="center">{x.overdue}</td><td align="center">{x.awaitingFirstContact}</td><td align="center">{x.openLeads}</td></tr>)}</tbody></table></div>
        </section>
      )}

      {leak && (
        <section className="card" aria-label="Leakage"><h2>Leakage</h2>
          <label htmlFor="assignee">Reassign to</label>
          <select id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Choose an agent…</option>{team?.members.map((x) => <option key={x.userId} value={x.userId}>{x.name}</option>)}</select>
          {([['Untouched', `over ${leak.untouched.thresholdHours} h`, leak.untouched, true], ['Abandoned', `${leak.abandoned.thresholdDays}+ days quiet`, leak.abandoned, true], ['Late first contact', 'this period', leak.lateFirstContact, false], ['Missed follow-ups', 'waiting', leak.missedFollowUps, true]] as [string, string, Bucket, boolean][]).map(([name, sub, b, canBulk]) => (
            <div key={name} className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }} data-testid={`leak-${name.toLowerCase().replace(/\W+/g, '-')}`}>
              <span><strong>{b.count}</strong> {name} <span className="reason">({sub})</span></span>
              {canBulk && b.count > 0 && <button onClick={() => reassign(b, name.toLowerCase())}>Reassign {Math.min(b.count, b.leads.length)}</button>}
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-label="Source quality"><h2>Sources</h2>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 14 }}><thead><tr><th align="left">Source</th><th>Leads</th><th>Contacted</th><th>Qualified</th><th>Won</th><th>Response</th></tr></thead>
          <tbody>{sources.map((s) => <tr key={s.name}><td>{s.name}</td><td align="center">{s.leads}</td><td align="center">{p(s.contactedPct)}</td><td align="center">{p(s.qualifiedPct)}</td><td align="center">{p(s.wonPct)}</td><td align="center">{dur(s.responseMedianS)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="card" aria-label="Agent scorecards"><h2>Agents</h2>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 14 }}><thead><tr><th align="left">Agent</th><th>Speed</th><th>Connect</th><th>Follow-ups</th><th>Skipped</th><th>Conversion</th></tr></thead>
          <tbody>{agents.map((a) => <tr key={a.userId}><td>{a.name}{a.verifiedCallShare !== null && a.verifiedCallShare < 100 ? <span className="reason" title="Some calls are self-reported"> *</span> : null}</td><td align="center">{dur(a.responseMedianS)}</td><td align="center">{p(a.connectRate)}</td><td align="center">{p(a.followUpPct)}</td><td align="center">{a.outcomeSkips}</td><td align="center">{p(a.conversionPct)}</td></tr>)}</tbody></table></div>
        <p className="reason">* includes self-reported call durations.</p>
      </section>
    </main>
  );
}
