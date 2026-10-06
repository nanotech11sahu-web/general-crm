import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { DomainError, LeadService, presentLead, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let svc: LeadService;
let A: string; let B: string;
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('domain_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); svc = new LeadService(db);
  const mk = async (slug: string, preset: string) => {
    const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug, country: 'IN' }));
    await runWithTenant(String(t._id), () => seedPreset(db.repos, preset));
    return String(t._id);
  };
  A = await mk('a', 'real_estate'); B = await mk('b', 'generic');
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('intake pipeline', () => {
  it('creates a lead with E.164 phone, default status, activity and outbox event', async () => {
    const r: any = await as(A, () => svc.intake({ name: '  Ravi   Kumar ', contacts: [{ value: '98765 43210' }, { value: 'Ravi@Example.com' }], source: { kind: 'api', name: 'API' } }));
    expect(r.outcome).toBe('created');
    const lead: any = await as(A, () => svc.get(r.leadId));
    expect(lead.displayName).toBe('Ravi Kumar');
    expect(lead.contacts.map((c: any) => c.valueNorm).sort()).toEqual(['+919876543210', 'ravi@example.com']);
    expect(lead.contacts.find((c: any) => c.isPrimary).kind).toBe('phone');
    const status: any = await as(A, () => db.repos.statuses.findById(lead.statusId));
    expect(status.name).toBe('New');
    expect((await as(A, () => svc.timeline(r.leadId))).items.map((a: any) => a.type)).toEqual(['lead_created']);
    expect(await as(A, () => db.repos.outbox.count({ type: 'lead.created', aggregateId: r.leadId }))).toBe(1);
  });

  it('dedupes by phone: second submission merges, adds new contact, logs re-enquiry', async () => {
    const first: any = await as(A, () => svc.intake({ name: 'Dup', contacts: [{ value: '9000000001' }] }));
    const second: any = await as(A, () => svc.intake({ name: 'Dup again', contacts: [{ value: '+91 90000 00001' }, { value: 'dup@x.io' }], campaign: 'Summer' }));
    expect(second).toMatchObject({ outcome: 'merged', leadId: first.leadId });
    const lead: any = await as(A, () => svc.get(first.leadId));
    expect(lead.contacts).toHaveLength(2);
    expect(lead.displayName).toBe('Dup'); // merge policy never overwrites
    const types = (await as(A, () => svc.timeline(first.leadId))).items.map((a: any) => a.type);
    expect(types).toContain('re_enquired');
    // new email now resolves to the same lead
    expect((await as(A, () => svc.intake({ contacts: [{ value: 'DUP@x.io' }] }))).leadId).toBe(first.leadId);
  });

  it('skip and overwrite policies', async () => {
    const f: any = await as(A, () => svc.intake({ name: 'Pol', city: 'Pune', contacts: [{ value: '9000000002' }] }));
    expect((await as(A, () => svc.intake({ name: 'X', contacts: [{ value: '9000000002' }] }, { dedupePolicy: 'skip' }))).outcome).toBe('skipped');
    await as(A, () => svc.intake({ name: 'New Name', city: 'Mumbai', contacts: [{ value: '9000000002' }] }, { dedupePolicy: 'overwrite' }));
    const lead: any = await as(A, () => svc.get(f.leadId));
    expect([lead.displayName, lead.city]).toEqual(['New Name', 'Mumbai']);
  });

  it('is race-safe: 12 concurrent submissions of one phone => exactly one lead', async () => {
    const results: any[] = await Promise.all(Array.from({ length: 12 }, () => as(A, () => svc.intake({ name: 'Race', contacts: [{ value: '9000000003' }] }))));
    expect(new Set(results.map((r) => r.leadId)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(await as(A, () => db.repos.contactIndex.count({ valueNorm: '+919000000003' }))).toBe(1);
  });

  it('externalRef makes redelivery idempotent per source', async () => {
    const i = { contacts: [{ value: '9000000004' }], source: { kind: 'meta', name: 'Meta' }, externalRef: 'meta-123' };
    const a: any = await as(A, () => svc.intake(i));
    const b: any = await as(A, () => svc.intake({ ...i, contacts: [{ value: '9000000005' }] }));
    expect(b).toMatchObject({ outcome: 'duplicate_event', leadId: a.leadId });
  });

  it('rejects, never silently drops, bad contacts', async () => {
    const r: any = await as(A, () => svc.intake({ name: 'Bad', contacts: [{ value: '12345' }, { value: 'nope' }] }));
    expect(r.outcome).toBe('rejected');
    expect(r.invalid).toHaveLength(2);
    expect((await as(A, () => svc.intake({ name: 'None', contacts: [] }))).outcome).toBe('rejected');
  });

  it('same phone in two tenants yields two independent leads', async () => {
    const a: any = await as(A, () => svc.intake({ contacts: [{ value: '9111111111' }] }));
    const b: any = await as(B, () => svc.intake({ contacts: [{ value: '9111111111' }] }));
    expect(a.outcome).toBe('created'); expect(b.outcome).toBe('created');
    expect(a.leadId).not.toBe(b.leadId);
    await expect(as(B, () => svc.get(a.leadId))).rejects.toThrow('Lead not found');
  });
});

describe('fields and status rules', () => {
  it('validates typed custom fields and logs diffs', async () => {
    const r: any = await as(A, () => svc.intake({ name: 'Cf', contacts: [{ value: '9222222222' }] }));
    await expect(as(A, () => svc.update(r.leadId, { custom: { bhk: '9', nope: 1 } }))).rejects.toMatchObject({ code: 'invalid_custom_fields', details: { bhk: expect.any(String), nope: 'unknown field' } });
    await as(A, () => svc.update(r.leadId, { custom: { bhk: '3', budget: '80L' }, city: 'Pune' }));
    const lead: any = await as(A, () => svc.get(r.leadId));
    expect(lead.custom).toMatchObject({ bhk: '3', budget: '80L' });
    const act = (await as(A, () => svc.timeline(r.leadId))).items.find((a: any) => a.type === 'field_changed');
    expect(act.payload.changes.city.to).toBe('Pune');
  });

  it('lost requires a reason; required fields block status; success logs activity', async () => {
    const r: any = await as(A, () => svc.intake({ name: 'St', contacts: [{ value: '9333333333' }] }));
    const lost: any = await as(A, () => db.repos.statuses.findOne({ kind: 'lost' }));
    const booked: any = await as(A, () => db.repos.statuses.findOne({ kind: 'won' }));
    await expect(as(A, () => svc.changeStatus(r.leadId, String(lost._id)))).rejects.toMatchObject({ code: 'status_requirements_not_met', details: { lostReasonId: expect.any(String) } });
    // make "budget" required for Booked
    const budget: any = await as(A, () => db.repos.customFields.findOne({ key: 'budget' }));
    await as(A, () => db.repos.customFields.updateOne({ _id: budget._id }, { $set: { requiredInStatusIds: [booked._id] } }));
    await expect(as(A, () => svc.changeStatus(r.leadId, String(booked._id)))).rejects.toMatchObject({ details: { 'custom.budget': expect.any(String) } });
    await as(A, () => svc.update(r.leadId, { custom: { budget: '1Cr' } }));
    await as(A, () => svc.changeStatus(r.leadId, String(booked._id)));
    const reason: any = await as(A, () => db.repos.lostReasons.findOne({}));
    await as(A, () => svc.changeStatus(r.leadId, String(lost._id), { lostReasonId: String(reason._id) }));
    const lead: any = await as(A, () => svc.get(r.leadId));
    expect(String(lead.lostReasonId)).toBe(String(reason._id));
    expect((await as(A, () => svc.timeline(r.leadId))).items.filter((a: any) => a.type === 'status_changed')).toHaveLength(2);
  });

  it("a status from another tenant cannot be used", async () => {
    const r: any = await as(A, () => svc.intake({ name: 'X', contacts: [{ value: '9444444444' }] }));
    const foreign: any = await as(B, () => db.repos.statuses.findOne({ kind: 'won' }));
    await expect(as(A, () => svc.changeStatus(r.leadId, String(foreign._id)))).rejects.toThrow('Status not found');
  });
});

describe('merge', () => {
  it('merges, keeps contacts/activities/tags, soft-deletes loser, and undoes cleanly', async () => {
    const w: any = await as(A, () => svc.intake({ name: 'Win', contacts: [{ value: '9555555551' }], tags: ['a'], custom: { budget: '1Cr' } }));
    const l: any = await as(A, () => svc.intake({ name: 'Lose', contacts: [{ value: '9555555552' }, { value: 'l@x.io' }], tags: ['b'], custom: { budget: '2Cr', project: 'P' } }));
    await as(A, () => svc.addNote(l.leadId, 'loser note'));
    const { mergeId } = await as(A, () => svc.merge(w.leadId, l.leadId));
    const win: any = await as(A, () => svc.get(w.leadId));
    expect(win.contacts).toHaveLength(3);
    expect(win.tags.sort()).toEqual(['a', 'b']);
    expect(win.custom).toMatchObject({ budget: '1Cr', project: 'P' }); // winner wins, gaps filled
    await expect(as(A, () => svc.get(l.leadId))).rejects.toThrow('Lead not found');
    expect((await as(A, () => svc.timeline(w.leadId))).items.some((a: any) => a.payload?.text === 'loser note')).toBe(true);
    // contact now resolves to winner
    expect((await as(A, () => svc.intake({ contacts: [{ value: '9555555552' }] }))).leadId).toBe(w.leadId);

    await as(A, () => svc.undoMerge(mergeId));
    const w2: any = await as(A, () => svc.get(w.leadId)); const l2: any = await as(A, () => svc.get(l.leadId));
    expect(w2.contacts).toHaveLength(1);
    expect(l2.contacts).toHaveLength(2);
    expect((await as(A, () => svc.timeline(l.leadId))).items.some((a: any) => a.payload?.text === 'loser note')).toBe(true);
    await expect(as(A, () => svc.undoMerge(mergeId))).rejects.toMatchObject({ code: 'already_undone' });
  });
  it('cannot merge across tenants or into itself', async () => {
    const a: any = await as(A, () => svc.intake({ contacts: [{ value: '9666666661' }] }));
    const b: any = await as(B, () => svc.intake({ contacts: [{ value: '9666666662' }] }));
    await expect(as(A, () => svc.merge(a.leadId, b.leadId))).rejects.toThrow('Lead not found');
    await expect(as(A, () => svc.merge(a.leadId, a.leadId))).rejects.toBeInstanceOf(DomainError);
  });
});

describe('custody presenter', () => {
  it('agents get masked contacts only; managers get full values', async () => {
    const r: any = await as(A, () => svc.intake({ name: 'Cust', contacts: [{ value: '9777777777' }, { value: 'secret@x.io' }] }));
    const lead = await as(A, () => svc.get(r.leadId));
    const agent = JSON.stringify(presentLead(lead, 'agent'));
    expect(agent).not.toContain('9777777777'); expect(agent).not.toContain('secret@'); expect(agent).not.toContain('phoneNorms');
    expect(agent).toContain('91••••••••77');
    expect(JSON.stringify(presentLead(lead, 'manager'))).toContain('+919777777777');
  });
});
