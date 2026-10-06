'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api, getToken, refresh } from '../../lib/api';

interface Lead { _id: string; displayName: string; city?: string; statusId?: string; ownerId?: string | null; tags?: string[]; createdAt: string; contacts: { kind: string; display: string }[] }
interface Status { _id: string; name: string; kind: string; position: number }
interface Member { userId: string; name?: string; role: string; status: string }
interface View { _id: string; name: string; shared: boolean; filter: Record<string, unknown> }
type Filter = { q?: string; statusId?: string; ownerId?: string; unassigned?: boolean; tag?: string; city?: string; untouchedDays?: number };
const small = { minHeight: 36, padding: '0 12px' };

/** The lead list: search, filters, saved views, bulk actions (managers and admins can also reassign, delete and export). */
export default function Leads() {
  const router = useRouter();
  const [ready, setReady] = useState(false); const [role, setRole] = useState('agent'); const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState<Filter>({}); const [items, setItems] = useState<Lead[]>([]); const [next, setNext] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Status[]>([]); const [users, setUsers] = useState<Member[]>([]); const [views, setViews] = useState<View[]>([]); const [sel, setSel] = useState<Set<string>>(new Set());
  const manager = role !== 'agent';
  const qs = useCallback((x: Filter, cursor?: string) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(x)) if (v !== undefined && v !== '' && v !== false) p.set(k, String(v)); if (cursor) p.set('cursor', cursor); p.set('limit', '50'); return p.toString(); }, []);
  const load = useCallback(async (x: Filter, more = false, cursor?: string) => {
    setBusy(true);
    try { const r = await api<{ items: Lead[]; nextCursor: string | null }>(`/v1/leads?${qs(x, more ? cursor : undefined)}`); setItems((cur) => (more ? [...cur, ...r.items] : r.items)); setNext(r.nextCursor); if (!more) setSel(new Set()); }
    catch (e) { if (e instanceof ApiError && e.status === 401) router.replace('/login'); else setMsg(e instanceof ApiError ? e.message : 'Could not load leads'); } finally { setBusy(false); }
  }, [qs, router]);
  useEffect(() => { (async () => {
    if (!(await refresh())) { router.replace('/login'); return; }
    setReady(true);
    const me = await api<{ role: string }>('/v1/me').catch(() => ({ role: 'agent' })); setRole(me.role);
    const [s, v, u] = await Promise.all([api<Status[]>('/v1/statuses'), api<View[]>('/v1/views'), me.role === 'agent' ? Promise.resolve([] as Member[]) : api<Member[]>('/v1/users').catch(() => [] as Member[])]);
    setStatuses(s); setViews(v); setUsers(u); await load({});
  })(); }, [router, load]);
  const sName = useMemo(() => new Map(statuses.map((s) => [s._id, s.name])), [statuses]);
  const uName = useMemo(() => new Map(users.map((u) => [u.userId, u.name ?? ''])), [users]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => { setMsg(null); try { await fn(); if (ok) setMsg(ok); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Something went wrong'); } };
  const apply = (x: Filter) => { setF(x); void load(x); };
  const bulk = (body: Record<string, unknown>, ok: string) => act(async () => { const r = await api<{ updated: number; failed: unknown[] }>('/v1/leads/bulk', { method: 'POST', body: { ids: [...sel], ...body } }); setMsg(`${ok}: ${r.updated} lead${r.updated === 1 ? '' : 's'}${r.failed.length ? `, ${r.failed.length} could not be changed` : ''}`); await load(f); });
  const exportCsv = () => act(async () => { const r = await fetch(`/v1/leads-export?${qs(f)}`, { headers: { authorization: `Bearer ${getToken()}` }, credentials: 'same-origin' }); if (!r.ok) throw new ApiError(r.status, 'error', 'Export is not available'); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'leads.csv'; a.click(); URL.revokeObjectURL(a.href); });
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const agents = users.filter((u) => u.status === 'active');

  if (!ready) return <main><p className="reason">Loading…</p></main>;
  return (
    <main>
      <div className="bar"><h1>Leads</h1></div>
      {msg && <p className="reason" role="status">{msg}</p>}
      <form className="card" onSubmit={(e) => { e.preventDefault(); void load(f); }} data-testid="filters">
        <input aria-label="Search leads" type="search" placeholder="Search name, phone, email…" value={f.q ?? ''} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <div className="row" style={{ marginTop: 8 }}>
          <select aria-label="Status" value={f.statusId ?? ''} onChange={(e) => apply({ ...f, statusId: e.target.value || undefined })} style={{ flex: 1 }}><option value="">Any status</option>{statuses.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
          {manager && <select aria-label="Owner" value={f.unassigned ? 'none' : f.ownerId ?? ''} onChange={(e) => apply({ ...f, ownerId: e.target.value && e.target.value !== 'none' ? e.target.value : undefined, unassigned: e.target.value === 'none' || undefined })} style={{ flex: 1 }}><option value="">Anyone</option><option value="none">Unassigned</option>{agents.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</select>}
          <select aria-label="Not contacted" value={f.untouchedDays ?? ''} onChange={(e) => apply({ ...f, untouchedDays: e.target.value ? Number(e.target.value) : undefined })} style={{ flex: 1 }}><option value="">Any activity</option><option value="1">Untouched 1+ day</option><option value="3">Untouched 3+ days</option><option value="7">Untouched 7+ days</option></select>
        </div>
        <div className="row" style={{ marginTop: 8 }}><button className="primary" style={small}>Search</button><button type="button" style={small} onClick={() => apply({})}>Clear</button>
          <select aria-label="Saved views" value="" onChange={(e) => { const v = views.find((x) => x._id === e.target.value); if (v) apply(v.filter as Filter); }} style={{ flex: 1, minHeight: 36 }}><option value="">Saved views…</option>{views.map((v) => <option key={v._id} value={v._id}>{v.name}{v.shared ? ' (shared)' : ''}</option>)}</select>
          <button type="button" style={small} onClick={() => { const name = window.prompt('Name this view'); if (!name?.trim()) return; const shared = manager && window.confirm('Share this view with the whole team?'); void act(async () => { await api('/v1/views', { method: 'POST', body: { name: name.trim(), filter: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== '')), shared } }); setViews(await api<View[]>('/v1/views')); }, 'View saved'); }}>Save view</button>
          {manager && <button type="button" style={small} onClick={exportCsv}>Export CSV</button>}</div>
      </form>

      {sel.size > 0 && (<div className="card" role="region" aria-label="Bulk actions" data-testid="bulk"><b>{sel.size} selected</b>
        <div className="row" style={{ marginTop: 8 }}>
          <select aria-label="Bulk status" value="" onChange={(e) => { if (e.target.value) void bulk({ action: 'status', statusId: e.target.value }, 'Status changed'); }} style={{ flex: 1, minHeight: 36 }}><option value="">Change status…</option>{statuses.filter((s) => s.kind === 'open').map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
          {manager && <select aria-label="Bulk assign" value="" onChange={(e) => { if (e.target.value) void bulk({ action: 'assign', ownerId: e.target.value === 'none' ? null : e.target.value }, 'Reassigned'); }} style={{ flex: 1, minHeight: 36 }}><option value="">Assign to…</option><option value="none">Unassign</option>{agents.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}</select>}
          <button style={small} onClick={() => { const tag = window.prompt('Tag to add'); if (tag?.trim()) void bulk({ action: 'tag', tag: tag.trim() }, 'Tagged'); }}>Add tag</button>
          {manager && <button style={small} onClick={() => { if (window.confirm(`Delete ${sel.size} leads? They can be restored for 30 days.`)) void bulk({ action: 'delete' }, 'Deleted'); }}>Delete</button>}
        </div></div>)}

      {items.length === 0 && !busy && <div className="empty"><p>No leads match.</p></div>}
      <ul className="list card" style={{ padding: '0 16px' }} data-testid="lead-list">
        {items.map((l) => (<li key={l._id} style={{ alignItems: 'center' }}>
          <input type="checkbox" aria-label={`Select ${l.displayName}`} checked={sel.has(l._id)} onChange={() => toggle(l._id)} style={{ width: 22, minHeight: 22, flex: 'none' }} />
          <a href={`/lead/${l._id}`} onClick={(e) => { e.preventDefault(); router.push(`/lead/${l._id}`); }} style={{ flex: 1, color: 'inherit', textDecoration: 'none' }}><b>{l.displayName}</b><br /><span className="reason">{l.contacts[0]?.display ?? ''}{l.city ? ` · ${l.city}` : ''}{(l.tags ?? []).length ? ` · ${(l.tags ?? []).join(', ')}` : ''}</span></a>
          <span style={{ textAlign: 'right' }}><span className="pill">{sName.get(String(l.statusId)) ?? '—'}</span><br /><span className="reason">{l.ownerId ? uName.get(String(l.ownerId)) ?? '' : 'unassigned'}</span></span></li>))}
      </ul>
      {next && <div className="row"><button disabled={busy} onClick={() => load(f, true, next)}>Load more</button></div>}
    </main>
  );
}
