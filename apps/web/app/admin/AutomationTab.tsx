'use client';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useResource } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface Tpl { _id: string; name: string; channel: string; status: string }
interface Step { offsetMinutes: number; action: 'task' | 'message'; channel?: 'whatsapp' | 'sms'; templateId?: string; taskType?: string; note?: string }
interface Cadence { _id?: string; name: string; active: boolean; steps: Step[]; stopOn: Record<string, boolean>; enrollOn: { statusIds?: string[] } }
interface Status { _id: string; name: string }
interface First { enabled: boolean; channel: 'whatsapp' | 'sms'; templateId: string; delayMinutes: number }
const small = { minHeight: 32, padding: '0 10px' };
const STOPS: [string, string][] = [['inboundReply', 'The lead replies'], ['connectedCall', 'A call connects'], ['statusChange', 'Status changes'], ['optOut', 'The lead opts out']];
const blank = (): Cadence => ({ name: '', active: true, steps: [{ offsetMinutes: 60, action: 'task', taskType: 'call', note: 'Follow up with the lead' }], stopOn: { inboundReply: true, connectedCall: true, statusChange: true, optOut: true }, enrollOn: {} });
const when = (m: number) => (m % 1440 === 0 ? `${m / 1440} d` : m % 60 === 0 ? `${m / 60} h` : `${m} min`);

/** First-touch message (instant WhatsApp/SMS to new leads) and follow-up cadences. */
export default function AutomationTab({ run }: { run: Run }) {
  const tpls = useResource<Tpl[]>('/v1/templates?status=approved', []); const statuses = useResource<Status[]>('/v1/statuses', []); const cads = useResource<Cadence[]>('/v1/cadences', []);
  const [ft, setFt] = useState<First>({ enabled: false, channel: 'whatsapp', templateId: '', delayMinutes: 0 });
  const [edit, setEdit] = useState<Cadence | null>(null);
  useEffect(() => { api<First>('/v1/settings/first-touch').then((x) => setFt({ enabled: !!x.enabled, channel: x.channel ?? 'whatsapp', templateId: x.templateId ?? '', delayMinutes: x.delayMinutes ?? 0 })).catch(() => undefined); }, []);
  const ok = tpls.data.filter((t) => t.status === 'approved');
  const save = async () => { if (!edit) return; const body = { name: edit.name, steps: edit.steps, stopOn: edit.stopOn, enrollOn: edit.enrollOn, ...(edit._id ? { active: edit.active } : {}) };
    if (await run(() => (edit._id ? api(`/v1/cadences/${edit._id}`, { method: 'PUT', body }) : api('/v1/cadences', { method: 'POST', body })), 'Cadence saved')) { setEdit(null); await cads.reload(); } };
  const step = (i: number, p: Partial<Step>) => edit && setEdit({ ...edit, steps: edit.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  return (<>
    <section className="card" data-testid="first-touch"><h2>First touch</h2><p className="reason">Send an approved template to every new lead (not imports or sample data), then keep the task queue for the call.</p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={ft.enabled} onChange={(e) => setFt({ ...ft, enabled: e.target.checked })} /> Send automatically</label>
      <div className="row"><select aria-label="First touch channel" value={ft.channel} onChange={(e) => setFt({ ...ft, channel: e.target.value as 'whatsapp' | 'sms', templateId: '' })} style={{ flex: 1 }}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select>
        <select aria-label="First touch template" value={ft.templateId} onChange={(e) => setFt({ ...ft, templateId: e.target.value })} style={{ flex: 2 }}><option value="">Choose approved template…</option>{ok.filter((t) => t.channel === ft.channel).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></div>
      <label>Wait before sending (minutes)</label><input aria-label="First touch delay" type="number" min={0} max={1440} value={ft.delayMinutes} onChange={(e) => setFt({ ...ft, delayMinutes: Number(e.target.value) })} />
      <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={() => run(() => api('/v1/settings/first-touch', { method: 'PUT', body: ft }), 'First touch saved')}>Save</button></div></section>

    <section className="card" data-testid="cadences"><h2>Follow-up cadences</h2>
      {cads.data.length === 0 && !edit && <p className="reason">No cadences yet.</p>}
      <ul className="list">{cads.data.map((c) => (<li key={c._id}><span><b>{c.name}</b> {!c.active && <span className="pill">paused</span>}<br /><span className="reason">{c.steps.map((s) => `${when(s.offsetMinutes)}: ${s.action === 'task' ? s.taskType : s.channel}`).join(' → ')}</span></span>
        <span className="row"><button style={small} onClick={() => setEdit({ ...c, enrollOn: c.enrollOn ?? {} })}>Edit</button><button style={small} onClick={() => run(async () => { await api(`/v1/cadences/${c._id}`, { method: 'PUT', body: { active: !c.active } }); await cads.reload(); })}>{c.active ? 'Pause' : 'Resume'}</button></span></li>))}</ul>
      {!edit && <button onClick={() => setEdit(blank())}>New cadence</button>}</section>

    {edit && (<section className="card" data-testid="cadence-editor"><h2>{edit._id ? 'Edit cadence' : 'New cadence'}</h2>
      <input aria-label="Cadence name" placeholder="Name (e.g. No answer follow-up)" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
      {edit.steps.map((s, i) => (<div key={i} className="card" style={{ background: 'var(--bg)' }}>
        <div className="row"><div style={{ flex: 1 }}><label>After (minutes)</label><input aria-label={`Step ${i + 1} delay`} type="number" min={0} value={s.offsetMinutes} onChange={(e) => step(i, { offsetMinutes: Number(e.target.value) })} /></div>
          <div style={{ flex: 1 }}><label>Do</label><select aria-label={`Step ${i + 1} action`} value={s.action} onChange={(e) => step(i, { action: e.target.value as 'task' | 'message' })}><option value="task">Create a task</option><option value="message">Send a message</option></select></div></div>
        {s.action === 'task' ? (<div className="row"><select aria-label={`Step ${i + 1} task type`} value={s.taskType ?? 'call'} onChange={(e) => step(i, { taskType: e.target.value })} style={{ flex: 1 }}>{['call', 'whatsapp', 'sms', 'visit', 'other'].map((x) => <option key={x}>{x}</option>)}</select><input aria-label={`Step ${i + 1} note`} placeholder="What to do and why (10+ characters)" value={s.note ?? ''} onChange={(e) => step(i, { note: e.target.value })} style={{ flex: 2 }} /></div>)
          : (<div className="row"><select aria-label={`Step ${i + 1} channel`} value={s.channel ?? 'whatsapp'} onChange={(e) => step(i, { channel: e.target.value as 'whatsapp' | 'sms', templateId: '' })} style={{ flex: 1 }}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select>
            <select aria-label={`Step ${i + 1} template`} value={s.templateId ?? ''} onChange={(e) => step(i, { templateId: e.target.value })} style={{ flex: 2 }}><option value="">Approved template…</option>{ok.filter((t) => t.channel === (s.channel ?? 'whatsapp')).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></div>)}
        <button style={{ ...small, marginTop: 8 }} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, k) => k !== i) })}>Remove step</button></div>))}
      <button onClick={() => setEdit({ ...edit, steps: [...edit.steps, { offsetMinutes: (edit.steps.at(-1)?.offsetMinutes ?? 0) + 1440, action: 'task', taskType: 'call', note: '' }] })}>Add step</button>
      <h2 style={{ marginTop: 16 }}>Stop when</h2>
      {STOPS.map(([k, l]) => (<label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={!!edit.stopOn[k]} onChange={(e) => setEdit({ ...edit, stopOn: { ...edit.stopOn, [k]: e.target.checked } })} /> {l}</label>))}
      <h2 style={{ marginTop: 16 }}>Start automatically when a lead enters</h2>
      <select aria-label="Enrol on status" multiple value={edit.enrollOn.statusIds ?? []} onChange={(e) => setEdit({ ...edit, enrollOn: { ...edit.enrollOn, statusIds: [...e.target.selectedOptions].map((o) => o.value) } })}>{statuses.data.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select>
      <p className="reason">Leave empty to start it by hand from a lead.</p>
      <div className="row"><button className="primary" onClick={save}>Save cadence</button><button onClick={() => setEdit(null)}>Cancel</button></div></section>)}
  </>);
}
