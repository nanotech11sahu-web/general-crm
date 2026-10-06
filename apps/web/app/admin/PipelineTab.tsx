'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
import { csv, useResource } from '../../lib/admin';

interface Status { _id: string; name: string; kind: 'open' | 'won' | 'lost'; color?: string; position: number; requiresFields: string[] }
interface Reason { _id: string; label: string }
interface Field { _id: string; key: string; label: string; type: string; options: string[]; showInList?: boolean; requiredInStatusIds: string[] }
type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

/** Statuses (order, colour, required fields), lost reasons and custom fields. */
export default function PipelineTab({ run }: { run: Run }) {
  const st = useResource<Status[]>('/v1/statuses', []); const lr = useResource<Reason[]>('/v1/lost-reasons', []); const cf = useResource<Field[]>('/v1/custom-fields', []);
  const [ns, setNs] = useState({ name: '', kind: 'open' }); const [nr, setNr] = useState(''); const [nf, setNf] = useState({ key: '', label: '', type: 'text', options: '' });
  const statuses = [...st.data].sort((a, b) => a.position - b.position);
  const move = (i: number, d: -1 | 1) => { const ids = statuses.map((s) => s._id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; return run(async () => { await api('/v1/statuses-order', { method: 'PUT', body: { ids } }); await st.reload(); }); };
  return (<>
    <section className="card" data-testid="statuses"><h2>Pipeline statuses</h2>
      <ul className="list">{statuses.map((s, i) => (
        <li key={s._id}><span><b style={{ color: s.color }}>{s.name}</b> <span className="pill">{s.kind}</span>{s.requiresFields.length ? <span className="reason"> needs: {s.requiresFields.join(', ')}</span> : null}</span>
          <span className="row">
            <button aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={() => move(i, -1)} style={{ minHeight: 32, padding: '0 10px' }}>↑</button>
            <button aria-label={`Move ${s.name} down`} disabled={i === statuses.length - 1} onClick={() => move(i, 1)} style={{ minHeight: 32, padding: '0 10px' }}>↓</button>
            <button onClick={() => { const name = window.prompt('Rename status', s.name); if (name?.trim()) void run(async () => { await api(`/v1/statuses/${s._id}`, { method: 'PUT', body: { name: name.trim() } }); await st.reload(); }, 'Renamed'); }} style={{ minHeight: 32, padding: '0 10px' }}>Rename</button>
            <button onClick={() => { const v = window.prompt('Custom field keys required to enter this status (comma separated, blank for none)', s.requiresFields.join(', ')); if (v !== null) void run(async () => { await api(`/v1/statuses/${s._id}`, { method: 'PUT', body: { requiresFields: csv(v) } }); await st.reload(); }, 'Saved'); }} style={{ minHeight: 32, padding: '0 10px' }}>Requires…</button>
          </span></li>))}</ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/v1/statuses', { method: 'POST', body: ns }); setNs({ name: '', kind: 'open' }); await st.reload(); }, 'Status added'); }}>
        <input aria-label="New status name" placeholder="New status" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} style={{ flex: 2 }} required />
        <select aria-label="Status kind" value={ns.kind} onChange={(e) => setNs({ ...ns, kind: e.target.value })} style={{ flex: 1 }}><option value="open">open</option><option value="won">won</option><option value="lost">lost</option></select>
        <button className="primary">Add</button></form></section>

    <section className="card" data-testid="lost-reasons"><h2>Lost reasons</h2>
      <ul className="list">{lr.data.map((r) => (<li key={r._id}><span>{r.label}</span><span><button onClick={() => { const label = window.prompt('Rename reason', r.label); if (label?.trim()) void run(async () => { await api(`/v1/lost-reasons/${r._id}`, { method: 'PUT', body: { label: label.trim() } }); await lr.reload(); }); }} style={{ minHeight: 32, padding: '0 10px' }}>Rename</button></span></li>))}</ul>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/v1/lost-reasons', { method: 'POST', body: { label: nr } }); setNr(''); await lr.reload(); }, 'Reason added'); }}>
        <input aria-label="New lost reason" placeholder="New reason" value={nr} onChange={(e) => setNr(e.target.value)} required style={{ flex: 1 }} /><button className="primary">Add</button></form></section>

    <section className="card" data-testid="custom-fields"><h2>Custom fields</h2>
      <ul className="list">{cf.data.map((f) => (<li key={f._id}><span>{f.label} <span className="pill">{f.type}</span> <span className="reason">{f.key}{f.options.length ? ` · ${f.options.join(', ')}` : ''}</span></span>
        <span className="row"><button onClick={() => { const label = window.prompt('Label', f.label); if (label?.trim()) void run(async () => { await api(`/v1/custom-fields/${f._id}`, { method: 'PUT', body: { label: label.trim() } }); await cf.reload(); }); }} style={{ minHeight: 32, padding: '0 10px' }}>Rename</button>
          <button onClick={() => void run(async () => { await api(`/v1/custom-fields/${f._id}`, { method: 'PUT', body: { showInList: !f.showInList } }); await cf.reload(); })} style={{ minHeight: 32, padding: '0 10px' }}>{f.showInList ? 'Hide in list' : 'Show in list'}</button>
          <button onClick={() => { if (window.confirm(`Delete field “${f.label}”? Values already on leads are kept but no longer shown.`)) void run(async () => { await api(`/v1/custom-fields/${f._id}`, { method: 'DELETE' }); await cf.reload(); }, 'Deleted'); }} style={{ minHeight: 32, padding: '0 10px' }}>Delete</button></span></li>))}</ul>
      <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/v1/custom-fields', { method: 'POST', body: { key: nf.key, label: nf.label, type: nf.type, options: csv(nf.options) } }); setNf({ key: '', label: '', type: 'text', options: '' }); await cf.reload(); }, 'Field added'); }}>
        <div className="row"><input aria-label="Field key" placeholder="key (e.g. plot_size)" value={nf.key} onChange={(e) => setNf({ ...nf, key: e.target.value })} required style={{ flex: 1 }} /><input aria-label="Field label" placeholder="Label" value={nf.label} onChange={(e) => setNf({ ...nf, label: e.target.value })} required style={{ flex: 1 }} /></div>
        <div className="row" style={{ marginTop: 8 }}><select aria-label="Field type" value={nf.type} onChange={(e) => setNf({ ...nf, type: e.target.value })} style={{ flex: 1 }}>{['text', 'number', 'select', 'date', 'boolean'].map((t) => <option key={t}>{t}</option>)}</select>
          {nf.type === 'select' && <input aria-label="Field options" placeholder="options, comma separated" value={nf.options} onChange={(e) => setNf({ ...nf, options: e.target.value })} style={{ flex: 2 }} />}<button className="primary">Add field</button></div></form></section>
  </>);
}
