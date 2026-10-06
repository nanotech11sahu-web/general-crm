'use client';
import { useState } from 'react';

interface Summary { tenantsByStatus: Record<string, number>; trialsEndingIn7Days: number; subscriptions: { _id: string; count: number }[] }
interface Row { id: string; name: string; status: string; plan: string; subscription?: { status: string; seats: number }; createdAt?: string }
const small = { minHeight: 32, padding: '0 10px' };

/**
 * Support console for the platform operator. The token is typed in and held in memory only (never stored), and every call
 * is audited server-side. Shows counts and health, never customer content. The API answers 404 unless it is enabled.
 */
export default function Operator() {
  const [token, setToken] = useState(''); const [authed, setAuthed] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [sum, setSum] = useState<Summary | null>(null); const [rows, setRows] = useState<Row[]>([]); const [q, setQ] = useState(''); const [detail, setDetail] = useState<any>(null); const [audit, setAudit] = useState<any[]>([]);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const r = await fetch(`/platform${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 404) throw new Error('The operator console is not enabled on this deployment.'); if (r.status === 401) throw new Error('Wrong token.');
    const t = await r.text(); const j = t ? JSON.parse(t) : {}; if (!r.ok) throw new Error(j.message ?? 'Request failed'); return j;
  };
  const guard = async (fn: () => Promise<void>, ok?: string) => { setMsg(null); try { await fn(); if (ok) setMsg(ok); } catch (e) { setMsg((e as Error).message); } };
  const loadList = (query = q) => call(`/tenants?q=${encodeURIComponent(query)}`).then(setRows);
  const open = (id: string) => guard(async () => { setDetail(await call(`/tenants/${id}`)); });
  const act = (id: string, path: string, body: unknown, ok: string) => guard(async () => { await call(`/tenants/${id}/${path}`, 'POST', body); setDetail(await call(`/tenants/${id}`)); await loadList(); }, ok);

  if (!authed) return (
    <main><div className="bar"><h1>Operator</h1></div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void guard(async () => { setSum(await call('/summary')); await loadList(''); setAuthed(true); }); }}>
        <label htmlFor="op-token">Operator token</label><input id="op-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
        {msg && <p className="err" role="alert">{msg}</p>}<div className="row" style={{ marginTop: 12 }}><button className="primary">Enter</button></div></form></main>
  );
  return (
    <main>
      <div className="bar"><h1>Operator</h1><button style={small} onClick={() => { setToken(''); setAuthed(false); setDetail(null); }}>Lock</button></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      {sum && <section className="card" data-testid="op-summary"><h2>Platform</h2><p className="reason">{Object.entries(sum.tenantsByStatus).map(([k, v]) => `${v} ${k}`).join(' · ')} · {sum.trialsEndingIn7Days} trials ending within 7 days</p><p className="reason">{sum.subscriptions.map((s) => `${s.count} ${s._id}`).join(' · ')}</p></section>}
      <form className="card row" onSubmit={(e) => { e.preventDefault(); void guard(async () => { await loadList(); }); }}><input aria-label="Find a workspace" placeholder="Workspace name" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} /><button className="primary">Find</button></form>
      <ul className="list card" style={{ padding: '0 16px' }}>{rows.map((r) => (<li key={r.id}><span><b>{r.name}</b> <span className="pill">{r.status}</span><br /><span className="reason">{r.plan} · {r.subscription?.status} · {r.subscription?.seats} seats</span></span><span><button style={small} onClick={() => open(r.id)}>Open</button></span></li>))}</ul>
      {detail && (<section className="card" data-testid="op-detail"><h2>{detail.name}</h2>
        <p className="reason">{Object.entries(detail.counts ?? {}).filter(([, v]) => typeof v === "number").map(([k, v]) => `${v} ${k}`).join(" · ")}</p>
        <p className="reason">Plan {detail.entitlements?.plan ?? detail.entitlements?.status} · status {detail.entitlements?.status}</p>
        {(detail.alerts ?? []).map((a: any, i: number) => <p key={i} className="err">{a.title ?? a.rule ?? JSON.stringify(a)}</p>)}
        <div className="row">
          {detail.status === 'suspended' ? <button style={small} onClick={() => act(detail.id, 'unsuspend', {}, 'Unsuspended')}>Unsuspend</button> : <button style={small} onClick={() => { const reason = window.prompt('Reason for suspending'); if (reason) void act(detail.id, 'suspend', { reason }, 'Suspended'); }}>Suspend</button>}
          <button style={small} onClick={() => { const d = Number(window.prompt('Extend trial by how many days?', '7')); if (d > 0) void act(detail.id, 'extend-trial', { days: d }, 'Trial extended'); }}>Extend trial</button>
          <button style={small} onClick={() => { const plan = window.prompt('Plan (trial, starter, growth, scale)', 'growth'); const seats = Number(window.prompt('Seats', '5')); if (plan && seats > 0) void act(detail.id, 'subscription', { plan, seats }, 'Plan set'); }}>Set plan</button></div></section>)}
      <div className="row"><button style={small} onClick={() => guard(async () => { setAudit(await call('/audit')); })}>Show operator audit</button></div>
      {audit.length > 0 && <ul className="list card" style={{ padding: '0 16px' }}>{audit.slice(0, 30).map((a, i) => <li key={i}><span>{a.action}</span><span>{new Date(a.at ?? a.createdAt).toLocaleString()}</span></li>)}</ul>}
    </main>
  );
}
