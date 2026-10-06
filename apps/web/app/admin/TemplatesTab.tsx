'use client';
import { useState } from 'react';
import { api } from '../../lib/api';
import { csv, useResource } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface Tpl { _id: string; channel: string; name: string; body: string; variables: string[]; status: string; rejectionReason?: string; dltTemplateId?: string; category?: string }
const small = { minHeight: 32, padding: '0 10px' };
const DOT: Record<string, string> = { draft: '⚪', pending: '🟠', approved: '🟢', rejected: '🔴' };

/** Message templates: WhatsApp templates go to Meta for approval; SMS templates carry the DLT registration. */
export default function TemplatesTab({ run }: { run: Run }) {
  const t = useResource<Tpl[]>('/v1/templates', []);
  const [f, setF] = useState({ channel: 'whatsapp', name: '', body: '', variables: '', dltTemplateId: '', dltHeader: '', category: 'utility' });
  const create = (e: React.FormEvent) => { e.preventDefault(); void run(async () => {
    const body: any = { channel: f.channel, name: f.name, body: f.body, variables: csv(f.variables) };
    if (f.channel === 'whatsapp') body.category = f.category; else { if (f.dltTemplateId) body.dltTemplateId = f.dltTemplateId; if (f.dltHeader) body.dltHeader = f.dltHeader; }
    await api('/v1/templates', { method: 'POST', body }); setF({ ...f, name: '', body: '', variables: '' }); await t.reload();
  }, 'Template saved as a draft'); };
  return (<>
    <section className="card" data-testid="templates"><h2>Templates</h2>
      <div className="row" style={{ marginBottom: 8 }}><button onClick={() => run(async () => { await api('/v1/templates/sync', { method: 'POST' }); await t.reload(); }, 'Synced with the provider')} style={small}>Sync WhatsApp status</button></div>
      {t.data.length === 0 && <p className="reason">No templates yet. First messages to a new lead need an approved template.</p>}
      <ul className="list">{t.data.map((x) => (<li key={x._id} style={{ display: 'block' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><b>{DOT[x.status]} {x.name} <span className="pill">{x.channel}</span> <span className="pill">{x.status}</span></b>
          <span className="row">
            {x.channel === 'whatsapp' && x.status === 'draft' && <button onClick={() => run(async () => { await api(`/v1/templates/${x._id}/submit`, { method: 'POST' }); await t.reload(); }, 'Submitted for approval')} style={small}>Submit to WhatsApp</button>}
            {x.channel === 'whatsapp' && x.status === 'rejected' && <button onClick={() => run(async () => { await api(`/v1/templates/${x._id}/submit`, { method: 'POST' }); await t.reload(); }, 'Re-submitted')} style={small}>Re-submit</button>}
            {x.channel === 'sms' && x.status !== 'approved' && <button onClick={() => run(async () => { await api(`/v1/templates/${x._id}/approve`, { method: 'POST' }); await t.reload(); }, 'Marked as DLT-approved')} style={small}>Mark DLT-approved</button>}
            {x.status !== 'approved' && <button onClick={() => { const body = window.prompt('Edit text', x.body); if (body?.trim()) void run(async () => { await api(`/v1/templates/${x._id}`, { method: 'PUT', body: { body: body.trim() } }); await t.reload(); }, 'Updated'); }} style={small}>Edit</button>}
          </span></div>
        <p className="reason" style={{ margin: '4px 0' }}>{x.body}</p>
        {x.variables.length > 0 && <span className="reason">Variables: {x.variables.join(', ')}</span>}
        {x.rejectionReason && <p className="err">Rejected: {x.rejectionReason}</p>}</li>))}</ul></section>
    <section className="card"><h2>New template</h2>
      <form onSubmit={create}>
        <div className="row"><select aria-label="Template channel" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} style={{ flex: 1 }}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select>
          <input aria-label="Template name" placeholder="name (e.g. first_hello)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required style={{ flex: 2 }} /></div>
        <label>Text — use {'{{1}}'} or {'{{name}}'} for blanks</label><textarea aria-label="Template text" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required />
        <label>Variables, in order (comma separated)</label><input aria-label="Template variables" value={f.variables} onChange={(e) => setF({ ...f, variables: e.target.value })} placeholder="name, project" />
        {f.channel === 'whatsapp' ? (<><label>Category</label><select aria-label="Template category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="utility">Utility</option><option value="marketing">Marketing</option><option value="authentication">Authentication</option></select></>)
          : (<div className="row"><div style={{ flex: 1 }}><label>DLT template id</label><input aria-label="DLT template id" value={f.dltTemplateId} onChange={(e) => setF({ ...f, dltTemplateId: e.target.value })} /></div><div style={{ flex: 1 }}><label>DLT header (sender id)</label><input aria-label="DLT header" value={f.dltHeader} onChange={(e) => setF({ ...f, dltHeader: e.target.value })} /></div></div>)}
        <div className="row" style={{ marginTop: 12 }}><button className="primary">Save draft</button></div></form></section>
  </>);
}
