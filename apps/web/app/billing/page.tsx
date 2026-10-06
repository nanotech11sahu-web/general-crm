'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, refresh } from '../../lib/api';

interface PlanCard { key: string; name: string; pricePerSeatInr: number; blurb: string; limits: { maxSeats: number; connections: number; ai: boolean; cloudTelephony: boolean; leadsPerMonth: number | null } }
interface Overview { status: string; plan: string; planName: string; seats: number; restricted: boolean; reason: string | null; trialDaysLeft: number | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; paymentsEnabled: boolean; pending: { plan: string; seats: number; url: string } | null; plans: PlanCard[] }
interface Usage { seats: { used: number; members: number; pendingInvites: number; limit: number }; leads: { created: number; softLimit: number | null; nearLimit: boolean; overLimit: boolean }; messagesSent: number; aiRequests: number; connections: { used: number; limit: number } }
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

/** Plan, seats, usage. Everyone with admin rights can look; only the owner can buy, change seats or cancel. */
export default function Billing() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [role, setRole] = useState('agent'); const [o, setO] = useState<Overview | null>(null); const [u, setU] = useState<Usage | null>(null);
  const [seats, setSeats] = useState<Record<string, number>>({}); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [forbidden, setForbidden] = useState(false);
  const load = useCallback(async () => {
    try { const ov = await api<Overview>('/v1/billing'); setO(ov); setU(await api<Usage>('/v1/billing/usage')); setSeats((s) => ({ ...Object.fromEntries(ov.plans.map((p) => [p.key, Math.max(1, ov.seats)])), ...s })); }
    catch (e) { if (e instanceof ApiError && e.status === 403) setForbidden(true); else if (e instanceof ApiError && e.status === 401) router.replace('/login'); }
  }, [router]);
  useEffect(() => { (async () => { if (!(await refresh())) { router.replace('/login'); return; } setRole((await api<{ role: string }>('/v1/me')).role); setReady(true); await load(); })(); }, [router, load]);
  const owner = role === 'owner';
  const act = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); await load(); } catch (e) { setMsg(e instanceof ApiError ? `${e.message}` : 'Something went wrong. Try again.'); } finally { setBusy(false); } };
  if (forbidden) return <main><p className="reason" role="alert">Billing is for admins and owners.</p></main>;
  if (!ready || !o) return <main><p className="reason">Loading…</p></main>;
  const bar = (used: number, limit: number | null) => limit ? <div style={{ background: 'var(--line)', borderRadius: 6, height: 8 }}><div style={{ width: `${Math.min(100, (used / limit) * 100)}%`, background: used > limit ? '#b91c1c' : 'var(--accent, #2563eb)', height: 8, borderRadius: 6 }} /></div> : null;
  return (
    <main style={{ maxWidth: 900 }}>
      <div className="bar"><h1>Billing</h1><button onClick={() => router.push('/today')} style={{ minHeight: 36, padding: '0 12px' }}>Today</button></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      <section className="card" aria-label="Current plan" data-testid="current-plan"><h2>{o.planName}{o.status === 'trialing' && o.trialDaysLeft !== null ? ` · ${o.trialDaysLeft} day${o.trialDaysLeft === 1 ? '' : 's'} left` : ''}</h2>
        <p className="reason">Status: <strong>{o.status.replace('_', ' ')}</strong>{o.currentPeriodEnd ? ` · ${o.cancelAtPeriodEnd ? 'ends' : 'renews'} ${date(o.currentPeriodEnd)}` : ''}</p>
        {o.reason && <p className="err" role="alert">{o.reason}</p>}
        {o.pending && <p className="reason">A checkout for {o.pending.plan} ({o.pending.seats} seats) is waiting for payment. <a href={o.pending.url}>Continue to pay</a></p>}
        {u && (<><p className="reason">Seats: {u.seats.used} of {u.seats.limit} used ({u.seats.members} people{u.seats.pendingInvites ? `, ${u.seats.pendingInvites} invited` : ''})</p>{bar(u.seats.used, u.seats.limit)}
          <p className="reason">Leads this month: {u.leads.created}{u.leads.softLimit ? ` of ${u.leads.softLimit.toLocaleString('en-IN')} included` : ''}{u.leads.overLimit ? ' · over the included volume (we never block new leads)' : u.leads.nearLimit ? ' · approaching the included volume' : ''}</p>{bar(u.leads.created, u.leads.softLimit)}
          <p className="reason">Connections: {u.connections.used} of {u.connections.limit} · Messages sent: {u.messagesSent} · AI requests: {u.aiRequests}</p></>)}
        {o.status === 'active' && owner && !o.cancelAtPeriodEnd && <div className="row" style={{ marginTop: 12 }}>
          <label htmlFor="ns" style={{ margin: 0 }}>Seats</label><input id="ns" type="number" min={1} style={{ width: 90 }} value={seats[o.plan] ?? o.seats} onChange={(e) => setSeats({ ...seats, [o.plan]: Number(e.target.value) })} />
          <button disabled={busy} onClick={() => act(async () => { await api('/v1/billing/seats', { method: 'POST', body: { seats: seats[o.plan] ?? o.seats } }); setMsg('Seats updated. The new quantity is billed from the next cycle.'); })}>Update seats</button>
          <button disabled={busy} onClick={() => { if (window.confirm('Cancel at the end of the current period? You keep access until then.')) void act(async () => { await api('/v1/billing/cancel', { method: 'POST' }); setMsg('Cancelled. Access continues until the end of the period.'); }); }}>Cancel plan</button></div>}
        {o.cancelAtPeriodEnd && <p className="reason">Your plan will end on {date(o.currentPeriodEnd)}. Your data stays; the workspace becomes read-only until you choose a plan again.</p>}
      </section>
      {(o.status !== 'active' || o.plan === 'trial') && (
        <section aria-label="Plans" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
          {o.plans.map((p) => (
            <div className="card" key={p.key} data-testid={`plan-${p.key}`}><h2>{p.name}</h2><div className="name">{inr(p.pricePerSeatInr)}<span className="reason"> / seat / month</span></div>
              <p className="reason">{p.blurb}</p>
              <ul className="list"><li><span>Up to {p.limits.maxSeats} seats</span></li><li><span>{p.limits.connections} connections</span></li><li><span>{p.limits.cloudTelephony ? '✓' : '–'} Cloud calling + recordings</span></li><li><span>{p.limits.ai ? '✓' : '–'} AI assistance</span></li><li><span>{p.limits.leadsPerMonth ? `${p.limits.leadsPerMonth.toLocaleString('en-IN')} leads / month` : 'Unlimited leads'}</span></li></ul>
              {owner ? (<><label htmlFor={`s-${p.key}`}>Seats</label><input id={`s-${p.key}`} type="number" min={1} max={p.limits.maxSeats} value={seats[p.key] ?? 1} onChange={(e) => setSeats({ ...seats, [p.key]: Number(e.target.value) })} />
                <p className="reason">{inr(p.pricePerSeatInr * (seats[p.key] ?? 1))} per month + GST</p>
                <div className="row"><button className="primary" disabled={busy} onClick={() => act(async () => { const r = await api<{ url: string }>('/v1/billing/checkout', { method: 'POST', body: { plan: p.key, seats: seats[p.key] ?? 1 } }); window.location.assign(r.url); })}>Choose {p.name}</button></div></>)
                : <p className="reason">Ask the workspace owner to choose a plan.</p>}
            </div>
          ))}
        </section>
      )}
      <p className="reason">Messaging and calling are billed by your own providers (WhatsApp, MSG91, Exotel…), not by LeadDesk. Prices are per seat per month, excluding GST.</p>
    </main>
  );
}
