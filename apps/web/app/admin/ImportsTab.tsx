'use client';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api, getToken } from '../../lib/api';
import { useResource } from '../../lib/admin';

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
interface Upload { id: string; headers: string[]; rowCount: number; suggestedMapping: Record<string, string>; preview: string[][] }
interface Dry { total: number; new: number; duplicatesInFile: number; existing: number; invalid: number; sampleErrors: { rowNo: number; reason: string }[] }
interface Job { status: string; rowCount: number; stats?: { created?: number; merged?: number; skipped?: number; failed?: number; processed?: number } }
interface Field { key: string; label: string }
const CORE: [string, string][] = [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['city', 'City'], ['language', 'Language'], ['budgetText', 'Budget'], ['campaign', 'Campaign'], ['tags', 'Tags'], ['externalRef', 'External reference'], ['answer', 'Form answer'], ['ignore', 'Skip this column']];

/** CSV/XLSX import: upload, check the column mapping, see a dry run, then import and watch progress. */
export default function ImportsTab({ run }: { run: Run }) {
  const fields = useResource<Field[]>('/v1/custom-fields', []);
  const [up, setUp] = useState<Upload | null>(null); const [map, setMap] = useState<Record<string, string>>({}); const [policy, setPolicy] = useState('skip');
  const [dry, setDry] = useState<Dry | null>(null); const [jobId, setJobId] = useState<string | null>(null); const [job, setJob] = useState<Job | null>(null); const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!jobId) return; let stop = false; const tick = async () => { try { const j = await api<Job>(`/v1/imports/${jobId}`); if (stop) return; setJob(j); if (j.status === 'running' || j.status === 'queued') setTimeout(tick, 1000); } catch { /* retry on next click */ } }; void tick(); return () => { stop = true; }; }, [jobId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault(); const f = file.current?.files?.[0]; if (!f) return;
    await run(async () => {
      const fd = new FormData(); fd.append('file', f);
      const r = await fetch('/v1/imports', { method: 'POST', body: fd, credentials: 'same-origin', headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {} });
      const body = await r.json().catch(() => ({})); if (!r.ok) throw new ApiError(r.status, body.code ?? 'error', Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Upload failed', body.details);
      setUp(body); setMap(body.suggestedMapping); setDry(null); setJob(null); setJobId(null);
    });
  }
  const check = () => run(async () => { await api(`/v1/imports/${up!.id}/mapping`, { method: 'PUT', body: { mapping: map, dedupePolicy: policy } }); setDry(await api<Dry>(`/v1/imports/${up!.id}/dry-run`, { method: 'POST' })); });
  const start = () => run(async () => { await api(`/v1/imports/${up!.id}/run`, { method: 'POST', body: { dedupePolicy: policy } }); setJob({ status: 'running', rowCount: up!.rowCount }); setJobId(up!.id); }, 'Import started');
  const errors = async () => { const r = await fetch(`/v1/imports/${up!.id}/errors`, { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {}, credentials: 'same-origin' }); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'import-errors.csv'; a.click(); URL.revokeObjectURL(a.href); };
  const options = [...CORE, ...fields.data.map((f): [string, string] => [`custom.${f.key}`, `${f.label} (custom)`])];
  return (
    <section className="card" data-testid="imports"><h2>Import leads</h2>
      <form onSubmit={upload}><label htmlFor="import-file">CSV or Excel file</label><input id="import-file" ref={file} type="file" accept=".csv,.xlsx" required /><div className="row" style={{ marginTop: 8 }}><button className="primary">Upload</button></div></form>
      {up && (<>
        <h2 style={{ marginTop: 16 }}>Match your columns ({up.rowCount} rows)</h2>
        {up.headers.map((h) => (<div key={h} className="row" style={{ marginBottom: 6, alignItems: 'center' }}><span style={{ flex: 1 }}><b>{h}</b><br /><span className="reason">{up.preview[0]?.[up.headers.indexOf(h)] ?? ''}</span></span>
          <select aria-label={`Column ${h}`} value={map[h] ?? 'ignore'} onChange={(e) => setMap({ ...map, [h]: e.target.value })} style={{ flex: 1 }}>{options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>))}
        <label>If a lead already exists</label><select aria-label="Duplicate handling" value={policy} onChange={(e) => setPolicy(e.target.value)}><option value="skip">Skip it</option><option value="merge">Fill in the blanks</option><option value="overwrite">Overwrite with the file</option></select>
        <div className="row" style={{ marginTop: 12 }}><button onClick={check}>Check (dry run)</button></div>
        {dry && (<div data-testid="dry-run" className="card" style={{ background: 'var(--bg)', marginTop: 12 }}><b>{dry.new} new</b> · {dry.existing} already in your CRM · {dry.duplicatesInFile} repeated inside the file · <span className={dry.invalid ? 'err' : ''}>{dry.invalid} problems</span>
          {dry.sampleErrors.slice(0, 5).map((s) => <p key={s.rowNo} className="reason">Row {s.rowNo}: {s.reason}</p>)}
          <div className="row" style={{ marginTop: 8 }}><button className="primary" onClick={start} disabled={!!jobId}>Import {dry.new + (policy === 'skip' ? 0 : dry.existing)} leads</button></div></div>)}
        {job && (<p data-testid="import-status" role="status">{job.status === 'running' ? 'Importing…' : `Import ${job.status}`} {job.stats ? `· ${job.stats.created ?? 0} created · ${job.stats.merged ?? 0} merged · ${job.stats.skipped ?? 0} skipped · ${job.stats.failed ?? 0} failed` : ''} {(job.stats?.failed ?? 0) > 0 && <button onClick={errors} style={{ minHeight: 32, padding: '0 10px' }}>Download error file</button>}</p>)}
      </>)}
    </section>
  );
}
