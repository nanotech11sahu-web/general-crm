import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { newObjectId, toObjectId, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { customFieldErrors, LeadService, type DedupePolicy, type IntakeInput } from './lead-service';
import { normalizeContacts } from './normalize';

export const MAX_ROWS = 20_000;
export const MAX_BYTES = 5 * 1024 * 1024;
const MAX_COLS = 60;

/** Targets a column can map to. `custom.<key>` is validated against the tenant's field definitions. */
export const CORE_TARGETS = ['name', 'phone', 'email', 'city', 'language', 'budgetText', 'campaign', 'tags', 'externalRef', 'ignore'] as const;
export type Mapping = Record<string, string>; // header -> target

/** Spreadsheet formula-injection stripping: formulas never survive into stored text. */
export function cleanCell(v: unknown): string {
  let s: any = v;
  if (s && typeof s === 'object') {
    if (s instanceof Date) s = s.toISOString();
    else if ('result' in s) s = (s as any).result; // exceljs formula cell: keep the value, drop the formula
    else if ('text' in s) s = (s as any).text;
    else if ('richText' in s) s = (s as any).richText.map((r: any) => r.text).join('');
    else s = '';
  }
  s = String(s ?? '').split(String.fromCharCode(0)).join('').trim();
  return s.replace(/^[=@\t\r]+/, '').trim().slice(0, 1000);
}

export interface Parsed { headers: string[]; rows: string[][] }

export async function parseUpload(buf: Buffer, filename: string): Promise<Parsed> {
  if (buf.length > MAX_BYTES) throw new DomainError('file_too_large', `File exceeds ${MAX_BYTES / 1024 / 1024} MB`, undefined, 413);
  const lower = filename.toLowerCase();
  let table: unknown[][];
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8'); // csv-parse strips the BOM (bom: true)
    try { table = parseCsv(text, { skip_empty_lines: true, relax_column_count: true, bom: true }); }
    catch (e: any) { throw new DomainError('bad_file', `Could not read CSV: ${e.message}`); }
  } else if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as any); } catch { throw new DomainError('bad_file', 'Could not read XLSX file'); }
    const ws = wb.worksheets[0];
    if (!ws) throw new DomainError('bad_file', 'Workbook has no sheets');
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => { table.push((row.values as unknown[]).slice(1)); });
  } else {
    throw new DomainError('unsupported_type', 'Only .csv and .xlsx files are supported', undefined, 415);
  }
  if (table.length < 2) throw new DomainError('empty_file', 'File needs a header row and at least one data row');
  if (table.length - 1 > MAX_ROWS) throw new DomainError('too_many_rows', `Max ${MAX_ROWS} rows per import; split the file`, undefined, 413);
  const headers = (table[0] as unknown[]).map((h, i) => cleanCell(h) || `column_${i + 1}`).slice(0, MAX_COLS);
  // duplicate header names would collide as object keys
  const seen = new Map<string, number>();
  const uniq = headers.map((h) => { const n = (seen.get(h) ?? 0) + 1; seen.set(h, n); return n === 1 ? h : `${h}_${n}`; });
  const rows = table.slice(1).map((r) => uniq.map((_, i) => cleanCell((r as unknown[])[i])));
  return { headers: uniq, rows: rows.filter((r) => r.some(Boolean)) };
}

const HINTS: [string, RegExp][] = [
  ['phone', /(phone|mobile|mob|contact|whats?app|cell|number|tel)/i],
  ['email', /(e-?mail|mail id)/i],
  ['name', /^(full[\s_-]*name|name|lead[\s_-]*name|customer|client|first[\s_-]*name)/i],
  ['city', /(city|location|town)/i],
  ['language', /(language|lang)/i],
  ['budgetText', /(budget)/i],
  ['campaign', /(campaign|ad[\s_-]*name|utm)/i],
  ['tags', /(tags?|labels?)/i],
  ['externalRef', /(lead[\s_-]*id|external|reference|ref[\s_-]*id)/i],
];

/** Heuristic column detection (AI-assisted mapping is a later, optional layer). */
export async function suggestMapping(db: TenantDb, headers: string[]): Promise<Mapping> {
  const defs: any[] = await db.repos.customFields.find();
  const out: Mapping = {};
  const usedSingle = new Set<string>();
  for (const h of headers) {
    const custom = defs.find((d) => d.key.toLowerCase() === h.toLowerCase().replace(/\s+/g, '_') || d.label.toLowerCase() === h.toLowerCase());
    if (custom) { out[h] = `custom.${custom.key}`; continue; }
    const hit = HINTS.find(([t, re]) => re.test(h) && (t === 'phone' || !usedSingle.has(t)));
    if (hit) { out[h] = hit[0]; if (hit[0] !== 'phone') usedSingle.add(hit[0]); } else out[h] = 'ignore';
  }
  return out;
}

export async function validateMapping(db: TenantDb, headers: string[], mapping: Mapping) {
  const defs: any[] = await db.repos.customFields.find();
  const customKeys = new Set(defs.map((d) => `custom.${d.key}`));
  const errors: Record<string, string> = {};
  const singles = new Map<string, string>();
  for (const [h, t] of Object.entries(mapping)) {
    if (!headers.includes(h)) errors[h] = 'unknown column';
    else if (!(CORE_TARGETS as readonly string[]).includes(t) && !customKeys.has(t)) errors[h] = `unknown target "${t}"`;
    else if (!['phone', 'email', 'ignore', 'tags'].includes(t) && !t.startsWith('custom.')) {
      if (singles.has(t)) errors[h] = `"${t}" is already mapped from "${singles.get(t)}"`; else singles.set(t, h);
    }
  }
  const targets = Object.values(mapping);
  if (!targets.includes('phone') && !targets.includes('email')) errors._ = 'map at least one phone or email column';
  if (Object.keys(errors).length) throw new DomainError('invalid_mapping', 'Invalid column mapping', errors);
}

/** One spreadsheet row -> intake input (shared by dry run and the real run). */
export function rowToIntake(headers: string[], row: string[], mapping: Mapping, defs: any[]): IntakeInput {
  const get = (h: string) => row[headers.indexOf(h)] ?? '';
  const input: IntakeInput = { contacts: [], custom: {}, tags: [] };
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  for (const [h, t] of Object.entries(mapping)) {
    const v = get(h);
    if (!v || t === 'ignore') continue;
    if (t === 'phone' || t === 'email') input.contacts.push({ kind: t, value: v });
    else if (t === 'tags') input.tags!.push(...v.split(/[;,|]/).map((x) => x.trim()).filter(Boolean));
    else if (t.startsWith('custom.')) {
      const d = defByKey.get(t.slice(7));
      input.custom![t.slice(7)] = d?.type === 'number' ? Number(v) : d?.type === 'boolean' ? /^(1|true|yes|y)$/i.test(v) : v;
    } else (input as any)[t] = v;
  }
  return input;
}

export interface DryRunResult { total: number; new: number; duplicatesInFile: number; existing: number; invalid: number; sampleErrors: { rowNo: number; reason: string }[] }

export class ImportService {
  private readonly leads: LeadService;
  constructor(private readonly db: TenantDb) { this.leads = new LeadService(db); }
  private get r() { return this.db.repos; }

  async create(file: { buffer: Buffer; originalname: string }, createdBy?: string) {
    const { headers, rows } = await parseUpload(file.buffer, file.originalname);
    const job: any = await this.r.importJobs.create({ filename: file.originalname.slice(0, 200), headers, rowCount: rows.length, status: 'uploaded', createdBy, stats: {} });
    for (let i = 0; i < rows.length; i += 1000) {
      await this.r.importRows.createMany(rows.slice(i, i + 1000).map((data, j) => ({ jobId: job._id, rowNo: i + j + 2, data }))); // rowNo = spreadsheet line
    }
    return { id: String(job._id), headers, rowCount: rows.length, suggestedMapping: await suggestMapping(this.db, headers), preview: rows.slice(0, 5) };
  }

  private async job(id: string) {
    const j: any = await this.r.importJobs.findById(id);
    if (!j) throw notFound('Import');
    return j;
  }
  async get(id: string) {
    const j = await this.job(id);
    return { id: String(j._id), filename: j.filename, status: j.status, rowCount: j.rowCount, stats: j.stats, mapping: j.mapping, dedupePolicy: j.dedupePolicy, cursor: j.cursor };
  }

  async setMapping(id: string, mapping: Mapping, o: { dedupePolicy?: DedupePolicy; saveAs?: string } = {}) {
    const j = await this.job(id);
    if (j.status === 'running' || j.status === 'done') throw new DomainError('invalid_state', `Import is ${j.status}`);
    await validateMapping(this.db, j.headers, mapping);
    await this.r.importJobs.updateOne({ _id: j._id }, { $set: { mapping, status: 'mapped', dedupePolicy: o.dedupePolicy ?? j.dedupePolicy } });
    if (o.saveAs) await this.r.importMappings.updateOne({ name: o.saveAs }, { $set: { name: o.saveAs, mapping } }, { upsert: true });
    return this.get(id);
  }

  async savedMappings() { return this.r.importMappings.find(); }

  /** Counts new / duplicate / existing / invalid without writing a single lead. */
  async dryRun(id: string): Promise<DryRunResult> {
    const j = await this.job(id);
    if (!j.mapping) throw new DomainError('invalid_state', 'Set the column mapping first');
    const defs: any[] = await this.r.customFields.find();
    const tenant: any = await this.db.models.Tenant.findById(j.tenantId).lean().exec();
    const country = tenant?.country ?? 'IN';
    const res: DryRunResult = { total: 0, new: 0, duplicatesInFile: 0, existing: 0, invalid: 0, sampleErrors: [] };
    const seen = new Set<string>();
    for (let from = 0; ; from += 500) {
      const chunk: any[] = await this.r.importRows.find({ jobId: j._id }, { sort: { rowNo: 1 }, skip: from, limit: 500 });
      if (!chunk.length) break;
      const parsed = chunk.map((row) => {
        const input = rowToIntake(j.headers, row.data, j.mapping, defs);
        return { rowNo: row.rowNo, customErrors: customFieldErrors(defs, input.custom ?? {}), ...normalizeContacts(input.contacts, country) };
      });
      const keys = parsed.flatMap((p) => p.contacts.map((c) => ({ kind: c.kind, valueNorm: c.valueNorm })));
      const hits: any[] = keys.length ? await this.r.contactIndex.find({ $or: keys }) : [];
      const existing = new Set(hits.map((h) => `${h.kind}:${h.valueNorm}`));
      for (const p of parsed) {
        res.total++;
        if (Object.keys(p.customErrors).length) { res.invalid++; if (res.sampleErrors.length < 20) res.sampleErrors.push({ rowNo: p.rowNo, reason: `invalid custom fields: ${Object.entries(p.customErrors).map(([k, m]) => `${k} ${m}`).join('; ')}` }); continue; }
        if (!p.contacts.length) { res.invalid++; if (res.sampleErrors.length < 20) res.sampleErrors.push({ rowNo: p.rowNo, reason: p.invalid.length ? `invalid contact: ${p.invalid.map((i) => i.value).join(', ')}` : 'no phone or email' }); continue; }
        const ks = p.contacts.map((c) => `${c.kind}:${c.valueNorm}`);
        if (ks.some((k) => existing.has(k))) res.existing++;
        else if (ks.some((k) => seen.has(k))) res.duplicatesInFile++;
        else res.new++;
        ks.forEach((k) => seen.add(k));
      }
    }
    await this.r.importJobs.updateOne({ _id: j._id }, { $set: { status: j.status === 'mapped' ? 'dry_run_done' : j.status, 'stats.dryRun': res } });
    return res;
  }

  /** Atomic claim so two requests cannot run the same job; a stale running job (no heartbeat) can be resumed. */
  async claim(id: string): Promise<boolean> {
    const stale = new Date(Date.now() - 60_000);
    const got = await this.r.importJobs.findOneAndUpdate(
      { _id: id, $or: [{ status: { $in: ['mapped', 'dry_run_done', 'failed'] } }, { status: 'running', heartbeatAt: { $lt: stale } }], mapping: { $ne: null } },
      { $set: { status: 'running', heartbeatAt: new Date() } }, { new: true });
    return !!got;
  }

  /**
   * Chunked, idempotent, resumable. Every row goes through the SAME intake pipeline as webhook/API leads.
   * Progress (cursor + stats) is persisted per chunk; rows use a per-job externalRef so a re-run after a
   * crash cannot create duplicates or double-log re-enquiries.
   */
  async run(id: string, o: { chunk?: number } = {}) {
    const j = await this.job(id);
    const defs: any[] = await this.r.customFields.find();
    const policy: DedupePolicy = j.dedupePolicy;
    const chunk = o.chunk ?? 200;
    try {
      for (;;) {
        const fresh: any = await this.job(id);
        // rows already carrying an outcome were processed before a crash: skip them
        const rows: any[] = await this.r.importRows.find({ jobId: j._id, rowNo: { $gt: fresh.cursor }, outcome: null }, { sort: { rowNo: 1 }, limit: chunk });
        if (!rows.length) break;
        for (const row of rows) {
          const input = rowToIntake(j.headers, row.data, j.mapping, defs);
          input.source = { kind: 'import', name: 'Import' };
          input.externalRef = `${id}:${row.rowNo}`;
          let outcome: string; let reason: string | undefined;
          try {
            const out = await this.leads.intake(input, { dedupePolicy: policy });
            outcome = out.outcome;
            if (out.outcome === 'rejected') reason = out.reason + (out.invalid?.length ? `: ${out.invalid.map((i) => i.value).join(', ')}` : '');
          } catch (e: any) {
            outcome = 'rejected'; reason = String(e?.message ?? e).slice(0, 300);
          }
          if (outcome === 'rejected') await this.r.importRowErrors.updateOne({ jobId: j._id, rowNo: row.rowNo }, { $set: { raw: row.data, reason } }, { upsert: true });
          await this.r.importRows.updateOne({ _id: row._id }, { $set: { outcome } });
        }
        await this.r.importJobs.updateOne({ _id: j._id }, { $set: { cursor: rows[rows.length - 1].rowNo, heartbeatAt: new Date() } });
      }
      // authoritative stats come from the per-row outcomes, so crash-resume cannot skew them
      const agg: any[] = await this.r.importRows.aggregate([{ $match: { jobId: j._id } }, { $group: { _id: '$outcome', n: { $sum: 1 } } }]);
      const n = (k: string) => agg.find((x) => x._id === k)?.n ?? 0;
      const stats = { created: n('created'), merged: n('merged'), skipped: n('skipped'), rejected: n('rejected'), duplicateEvent: n('duplicate_event') };
      await this.r.importJobs.updateOne({ _id: j._id }, { $set: { status: 'done', 'stats.run': stats } });
      await this.r.outbox.add('import.completed', id, stats);
      return stats;
    } catch (e) {
      await this.r.importJobs.updateOne({ _id: j._id }, { $set: { status: 'failed' } });
      throw e;
    }
  }

  /** CSV of rejected rows with the reason, ready to fix and re-upload. */
  async errorCsv(id: string): Promise<string> {
    const j = await this.job(id);
    const errs: any[] = await this.r.importRowErrors.find({ jobId: j._id }, { sort: { rowNo: 1 }, limit: 50_000 });
    const esc = (v: string) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['row', 'reason', ...j.headers];
    return [head.map(esc).join(',')].concat(errs.map((e) => [String(e.rowNo), e.reason, ...j.headers.map((_: string, i: number) => e.raw?.[i] ?? '')].map(esc).join(','))).join('\n');
  }

  // exposed for the API layer
  ids = { newObjectId, toObjectId };
}
