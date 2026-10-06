'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';
import { Bars, color, Donut, Sparkline } from '../../components/charts';

type Range = 'today' | '7d' | '30d';
interface Kpis { metrics: { responseMedianS: number | null; withinSlaPct: number | null; connectRate: number | null; conversionPct: number | null; followUpPct: number | null }; counts: Record<string, number>; trendPct: Record<string, number | null> }
interface Team { members: { userId: string; name: string; presence: string; overdue: number; awaitingFirstContact: number; openLeads: number }[]; totalOverdue: number; unassignedAwaitingFirstContact: number }
interface Leak { untouched: { count: number }; abandoned: { count: number }; lateFirstContact: { count: number }; missedFollowUps: { count: number } }
interface Src { name: string; leads: number; wonPct: number | null }
interface Agent { userId: string; name: string; leads: number; calls: number; conversionPct: number | null; followUpPct: number | null }
interface Insight { id: string; severity: string; text: string }
interface TrendRow { day: string; leads: number; calls: number }
const dur = (s: number | null) => (s === null ? '–' : s < 90 ? `${s}s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const Delta = ({ v, goodUp = true }: { v: number | null | undefined; goodUp?: boolean }) => (v === null || v === undefined || v === 0 ? <span className="delta flat">no change</span> : <span className={`delta ${(v > 0) === goodUp ? 'up' : 'down'}`}>{v > 0 ? '↗' : '↘'} {Math.abs(v)}%</span>);
const PRESENCE: Record<string, string> = { online: 'pill live', on_call: 'pill brand', away: 'pill warn', offline: 'pill' };

/** Manager dashboard: headline numbers with trends, activity chart, source mix, team, leakage, top agents and what to look at today. */
export default function Dashboard() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [forbidden, setForbidden] = useState(false); const [range, setRange] = useState<Range>('7d'); const [busy, setBusy] = useState(false);
  const [k, setK] = useState<Kpis | null>(null); const [team, setTeam] = useState<Team | null>(null); const [leak, setLeak] = useState<Leak | null>(null); const [src, setSrc] = useState<Src[]>([]); const [agents, setAgents] = useState<Agent[]>([]); const [ins, setIns] = useState<Insight[]>([]); const [trend, setTrend] = useState<TrendRow[]>([]);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [a, b, c, d, e, f, g] = await Promise.all([api<Kpis>(`/v1/pulse/kpis?range=${range}`), api<Team>('/v1/pulse/team'), api<Leak>('/v1/pulse/leakage'), api<{ rows: Src[] }>(`/v1/pulse/sources?range=${range === 'today' ? '7d' : range}`), api<{ rows: Agent[] }>(`/v1/pulse/agents?range=${range}`), api<Insight[]>('/v1/pulse/insights'), api<TrendRow[]>('/v1/pulse/trend?days=14')]);
      setK(a); setTeam(b); setLeak(c); setSrc(d.rows); setAgents(e.rows); setIns(f); setTrend(g); setForbidden(false);
    } catch (e) { if (e instanceof ApiError && e.status === 403) setForbidden(true); else if (e instanceof ApiError && e.status === 401) router.replace('/login'); } finally { setBusy(false); }
  }, [range, router]);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setReady(true); })(); }, [router]);
  useEffect(() => { if (ready) void load(); }, [ready, load]);

  if (!ready) return <main><p className="reason">Loading…</p></main>;
  if (forbidden) return <main><div className="bar"><h1>Dashboard</h1></div><p className="reason">The dashboard is for managers, admins and owners. Your day is on the <a href="/today">Today</a> screen.</p></main>;
  const c = k?.counts ?? {}; const t = k?.trendPct ?? {}; const days = trend.map((r) => r.day.slice(5)); const leads = trend.map((r) => r.leads), calls = trend.map((r) => r.calls);
  const srcParts = src.slice(0, 6).map((s) => ({ label: s.name, value: s.leads })); const totalLeads = src.reduce((a, s) => a + s.leads, 0);
  const kpi = (label: string, value: string, sub: string, v: number | null | undefined, series: number[], stroke: string, icon: string, tone: string, goodUp = true) => (
    <div className="card kpi" key={label}><div className="ico" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone})` }}>{icon}</div><span className="spark"><Sparkline values={series} stroke={stroke} /></span>
      <div className="label">{label}</div><div className="value">{value}<small>{sub}</small></div><Delta v={v} goodUp={goodUp} /></div>);
  return (
    <main>
      <div className="bar"><div><h1>Dashboard</h1><p className="page-sub">How your leads are doing, and where to look first.</p></div>
        <div className="row" style={{ alignItems: 'center' }}>
          <select aria-label="Range" value={range} onChange={(e) => setRange(e.target.value as Range)} style={{ width: 'auto', minHeight: 40 }}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
          <button className="primary" onClick={() => load()} disabled={busy}>{busy ? 'Refreshing…' : '↻ Refresh data'}</button></div></div>

      <section className="grid g4" aria-label="Headline numbers">
        {kpi('New leads', compact(c.leads ?? 0), range === 'today' ? 'today' : `in ${range === '7d' ? '7' : '30'} days`, t.leads, leads, '#4f46e5', '👥', 'brand')}
        {kpi('Calls logged', compact(c.calls ?? 0), `${c.connected ?? 0} connected`, t.calls, calls, '#16a34a', '📞', 'ok')}
        {kpi('Deals won', compact(c.won ?? 0), `${k?.metrics.conversionPct ?? '–'}% conversion`, t.conversionPct, leads.map((l, i) => Math.round(l * 0.2 + (i % 3))), '#f59e0b', '🏆', 'warn')}
        {kpi('Median first response', dur(k?.metrics.responseMedianS ?? null), `${k?.metrics.withinSlaPct ?? '–'}% in SLA`, t.responseMedianS, calls, '#db2777', '⚡', 'pink', false)}
      </section>

      <section className="grid g2-1" style={{ marginTop: 16 }}>
        <div className="card"><div className="bar" style={{ margin: 0 }}><div><h2>Lead activity</h2><p className="page-sub">New leads and calls, last 14 days</p></div><span className="legend"><span><i style={{ background: '#4f46e5' }} />Leads</span><span><i style={{ background: '#16a34a' }} />Calls</span></span></div>
          {trend.length ? <Bars labels={days} a={leads} b={calls} /> : <p className="reason">Activity appears here once the first days have been summarised.</p>}
          <div className="tiles" style={{ marginTop: 12 }}><div className="tile" style={{ background: 'var(--brand-soft)' }}><b>{k?.metrics.followUpPct ?? '–'}%</b><span>Follow-ups on time</span></div><div className="tile" style={{ background: 'var(--ok-soft)' }}><b>{k?.metrics.connectRate ?? '–'}%</b><span>Call connect rate</span></div></div>
          {ins.length > 0 && <div className="alert-note" style={{ marginTop: 12 }}>⚠ {ins[0].text}</div>}</div>
        <div className="card"><h2>Lead sources</h2><p className="page-sub" style={{ marginBottom: 8 }}>Where your leads come from</p>
          {totalLeads ? (<><Donut parts={srcParts} center={compact(totalLeads)} sub="leads" /><div className="legend" style={{ marginTop: 12, justifyContent: 'center' }}>{srcParts.map((p, i) => <span key={p.label}><i style={{ background: color(i) }} />{p.label} · {Math.round((p.value / totalLeads) * 100)}%</span>)}</div></>) : <p className="reason">No leads in this range yet.</p>}</div>
      </section>

      <section className="grid g3" style={{ marginTop: 16 }}>
        <div className="card"><h2>Leaking leads</h2><p className="page-sub" style={{ marginBottom: 8 }}>Worth a look right now</p>
          {([['Never contacted', leak?.untouched.count, 'bad'], ['Missed follow-ups', leak?.missedFollowUps.count, 'warn'], ['Answered late', leak?.lateFirstContact.count, 'warn'], ['Gone quiet', leak?.abandoned.count, 'brand']] as const).map(([label, n, tone]) => (<div key={label} style={{ marginBottom: 12 }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{label}</span><b>{n ?? 0}</b></div><div className="bar-track"><i style={{ width: `${Math.min(100, (n ?? 0) * 8)}%`, background: `var(--${tone})` }} /></div></div>))}
          <button onClick={() => router.push('/pulse')} style={{ width: '100%' }}>Open Pulse →</button></div>
        <div className="card"><h2>Team right now</h2><p className="page-sub" style={{ marginBottom: 8 }}>{team?.unassignedAwaitingFirstContact ? `${team.unassignedAwaitingFirstContact} unassigned lead(s) waiting` : 'Everyone has their leads'}</p>
          <ul className="list">{(team?.members ?? []).slice(0, 6).map((m) => (<li key={m.userId}><span><b>{m.name}</b><br /><span className="reason" style={{ margin: 0 }}>{m.openLeads} open · {m.overdue} overdue</span></span><span className={PRESENCE[m.presence] ?? 'pill'}>{m.presence.replace('_', ' ')}</span></li>))}</ul>{!team?.members.length && <p className="reason">No team members yet.</p>}</div>
        <div className="card"><h2>What to look at</h2><p className="page-sub" style={{ marginBottom: 8 }}>Generated from your numbers</p>
          {ins.length ? <ul className="list">{ins.slice(0, 5).map((i) => (<li key={i.id} style={{ alignItems: 'flex-start' }}><span><span className={`pill ${i.severity === 'high' ? 'bad' : i.severity === 'medium' ? 'warn' : ''}`}>{i.severity}</span><br />{i.text}</span></li>))}</ul> : <p className="reason">Nothing unusual. Keep going.</p>}</div>
      </section>

      <section className="card" style={{ marginTop: 16 }}><div className="bar" style={{ margin: '0 0 8px' }}><div><h2>Top performing</h2><p className="page-sub">Leads, calls and follow-through per person</p></div><button onClick={() => router.push('/leads')}>View all leads →</button></div>
        <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Agent</th><th>Leads</th><th>Calls</th><th>Conversion</th><th>Follow-ups on time</th></tr></thead><tbody>
          {agents.slice(0, 8).map((a, i) => (<tr key={a.userId}><td><span className="avatar" style={{ display: 'inline-grid', width: 28, height: 28, fontSize: 12, marginRight: 8, background: color(i), verticalAlign: 'middle' }}>{a.name[0]}</span>{a.name}</td><td>{a.leads}</td><td>{a.calls}</td><td>{a.conversionPct ?? '–'}{a.conversionPct !== null ? '%' : ''}</td><td>{a.followUpPct ?? '–'}{a.followUpPct !== null ? '%' : ''}</td></tr>))}
          {!agents.length && <tr><td colSpan={5} className="reason">No agent activity in this range yet.</td></tr>}</tbody></table></div></section>
    </main>
  );
}
