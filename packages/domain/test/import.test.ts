import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { cleanCell, ImportService, LeadService, parseUpload, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let imp: ImportService; let leads: LeadService; let A: string; let B: string;
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
const csv = (s: string) => ({ buffer: Buffer.from(s), originalname: 'leads.csv' });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('import_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); imp = new ImportService(db); leads = new LeadService(db);
  const mk = async (slug: string) => {
    const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN' }));
    await runWithTenant(String(t._id), () => seedPreset(db.repos, 'real_estate'));
    return String(t._id);
  };
  A = await mk('a'); B = await mk('b');
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('parsing', () => {
  it('reads CSV with BOM, quotes and ragged rows; rejects unsupported/oversized/empty', async () => {
    const p = await parseUpload(Buffer.from('﻿Name,Mobile\n"Doe, John",9876543210\nAmy\n'), 'a.csv');
    expect(p.headers).toEqual(['Name', 'Mobile']);
    expect(p.rows).toEqual([['Doe, John', '9876543210'], ['Amy', '']]);
    await expect(parseUpload(Buffer.from('x'), 'a.pdf')).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(parseUpload(Buffer.from('only,header'), 'a.csv')).rejects.toMatchObject({ code: 'empty_file' });
    await expect(parseUpload(Buffer.alloc(6 * 1024 * 1024), 'a.csv')).rejects.toMatchObject({ code: 'file_too_large' });
  });
  it('reads XLSX and keeps formula RESULTS, never formulas', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
    ws.addRow(['Name', 'Phone']); ws.addRow(['Xl', 9876543210]); ws.addRow([{ formula: '1+1', result: 2 }, '9876543211']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await parseUpload(buf, 'a.xlsx');
    expect(p.rows).toEqual([['Xl', '9876543210'], ['2', '9876543211']]);
  });
  it('neutralises formula injection and de-duplicates header names', async () => {
    expect(cleanCell('=cmd|\' /C calc\'!A0')).not.toMatch(/^=/);
    expect(cleanCell('@SUM(A1)')).not.toMatch(/^@/);
    const p = await parseUpload(Buffer.from('Phone,Phone\n9876543210,9876543211'), 'a.csv');
    expect(p.headers).toEqual(['Phone', 'Phone_2']);
  });
});

describe('import flow', () => {
  const FILE = [
    'Full Name,Mobile Number,Alt Phone,Email,City,BHK,Budget,Tags',
    'Asha Rao,98765 43210,,asha@x.io,Pune,2,80L,hot;vip',
    'Bad Phone,12345,,,Pune,,,',
    'Asha Duplicate,+919876543210,,,Pune,,,',        // duplicate of row 1 inside the file
    'Existing Person,9000011111,,,Mumbai,3,,',        // already in the CRM
    'Two Phones,9000022222,9000033333,,Delhi,,,',
    ',,,,,,,',                                        // blank row ignored
    'Only Email,,,only@x.io,,,,',
    'Weird BHK,9000044444,,,,99,,',                   // fails custom-field validation
  ].join('\n');

  it('uploads, suggests a mapping, dry-runs, runs, reports errors, and is idempotent on re-run', async () => {
    await as(A, () => leads.intake({ name: 'Existing', contacts: [{ value: '9000011111' }] }));
    const up: any = await as(A, () => imp.create(csv(FILE)));
    expect(up.rowCount).toBe(7); // blank row dropped
    expect(up.suggestedMapping).toMatchObject({ 'Full Name': 'name', 'Mobile Number': 'phone', 'Alt Phone': 'phone', Email: 'email', City: 'city', BHK: 'custom.bhk', Budget: 'custom.budget', Tags: 'tags' });

    await expect(as(A, () => imp.setMapping(up.id, { 'Full Name': 'name' }))).rejects.toMatchObject({ code: 'invalid_mapping' });
    await expect(as(A, () => imp.setMapping(up.id, { ...up.suggestedMapping, City: 'bogus' }))).rejects.toMatchObject({ code: 'invalid_mapping' });
    await as(A, () => imp.setMapping(up.id, up.suggestedMapping, { saveAs: 'Standard' }));
    expect(((await as(A, () => imp.savedMappings())) as any[]).map((m) => m.name)).toEqual(['Standard']);

    const before = await as(A, () => db.repos.leads.count());
    const dry: any = await as(A, () => imp.dryRun(up.id));
    expect(dry).toMatchObject({ total: 7, invalid: 2, duplicatesInFile: 1, existing: 1, new: 3 });
    expect(dry.sampleErrors[0].rowNo).toBe(3);
    expect(await as(A, () => db.repos.leads.count())).toBe(before); // dry run writes nothing

    expect(await as(A, () => imp.claim(up.id))).toBe(true);
    expect(await as(A, () => imp.claim(up.id))).toBe(false); // already running
    const stats: any = await as(A, () => imp.run(up.id, { chunk: 3 }));
    expect(stats).toMatchObject({ created: 3, merged: 2, rejected: 2 });
    // created: Asha, Two Phones, Only Email ; merged: Asha dup + Existing ; rejected: bad phone + BHK 99 (not an allowed option)
    expect(((await as(A, () => imp.get(up.id))) as any).status).toBe('done');

    const asha: any = ((await as(A, () => db.repos.leads.find({ displayName: 'Asha Rao' }))) as any[])[0];
    expect(asha.custom).toMatchObject({ bhk: '2', budget: '80L' });
    expect(asha.tags.sort()).toEqual(['hot', 'vip']);
    expect(asha.contacts.map((c: any) => c.valueNorm).sort()).toEqual(['+919876543210', 'asha@x.io']);
    const two: any = ((await as(A, () => db.repos.leads.find({ displayName: 'Two Phones' }))) as any[])[0];
    expect(two.contacts).toHaveLength(2);

    const err = await as(A, () => imp.errorCsv(up.id));
    expect(err.split('\n')[0]).toBe('row,reason,Full Name,Mobile Number,Alt Phone,Email,City,BHK,Budget,Tags');
    expect(err).toContain('Bad Phone');
    expect(err).toContain('invalid custom fields: bhk must be one of');

    // crash-resume / re-run: reset cursor and run again => no duplicates, no extra re-enquiry activities
    const leadsBefore = await as(A, () => db.repos.leads.count());
    const actsBefore = await as(A, () => db.repos.activities.count());
    await as(A, () => db.repos.importJobs.updateOne({ _id: up.id }, { $set: { cursor: 0, status: 'mapped' } }));
    await as(A, () => imp.claim(up.id));
    expect(await as(A, () => imp.run(up.id))).toMatchObject({ created: 3, merged: 2, rejected: 2 });
    expect(await as(A, () => db.repos.importRowErrors.count({ jobId: up.id }))).toBe(2);
    expect(await as(A, () => db.repos.leads.count())).toBe(leadsBefore);
    expect(await as(A, () => db.repos.activities.count())).toBe(actsBefore);
  });

  it('skip policy leaves existing leads untouched', async () => {
    await as(A, () => leads.intake({ name: 'Keep', contacts: [{ value: '9100000001' }] }));
    const up: any = await as(A, () => imp.create(csv('Name,Phone\nChanged,9100000001\nFresh,9100000002')));
    await as(A, () => imp.setMapping(up.id, { Name: 'name', Phone: 'phone' }, { dedupePolicy: 'skip' }));
    await as(A, () => imp.claim(up.id));
    const s: any = await as(A, () => imp.run(up.id));
    expect(s).toMatchObject({ created: 1, skipped: 1 });
    expect(((await as(A, () => db.repos.leads.find({ displayName: 'Keep' }))) as any[]).length).toBe(1);
  });

  it('another tenant cannot see, map, run or download someone else\'s import', async () => {
    const up: any = await as(A, () => imp.create(csv('Name,Phone\nSecret,9200000001')));
    await expect(as(B, () => imp.get(up.id))).rejects.toThrow('Import not found');
    await expect(as(B, () => imp.setMapping(up.id, { Name: 'name', Phone: 'phone' }))).rejects.toThrow('Import not found');
    expect(await as(B, () => imp.claim(up.id))).toBe(false);
    await expect(as(B, () => imp.errorCsv(up.id))).rejects.toThrow('Import not found');
    expect(await as(B, () => db.repos.importRows.count())).toBe(0);
  });

  it('cannot run before a mapping exists; running job is not re-claimable until stale', async () => {
    const up: any = await as(A, () => imp.create(csv('Name,Phone\nN,9300000001')));
    expect(await as(A, () => imp.claim(up.id))).toBe(false);
    await as(A, () => imp.setMapping(up.id, { Name: 'name', Phone: 'phone' }));
    expect(await as(A, () => imp.claim(up.id))).toBe(true);
    expect(await as(A, () => imp.claim(up.id))).toBe(false);
    await as(A, () => db.repos.importJobs.updateOne({ _id: up.id }, { $set: { heartbeatAt: new Date(Date.now() - 120_000) } }));
    expect(await as(A, () => imp.claim(up.id))).toBe(true); // stale heartbeat => resumable
  });
});
