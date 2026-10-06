import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry, MessageRejectedError, type Connector } from '@leaddesk/connectors-core';
import { LocalKeyService } from '@leaddesk/crypto';
import { migrateUp, runAsSystem, runWithTenant, TenantDbRouter } from '@leaddesk/db';
import { ConnectionService, InboxService, LeadService, MessagingService, isStartWord, isStopWord, renderTemplate, seedPreset } from '../src';

let rs: MongoMemoryReplSet; let router: TenantDbRouter; let db: any; let keys: LocalKeyService; let leads: LeadService;
const sent: any[] = [];
const beh = { reject: null as null | 'window_closed', transport: false, calls: 0 };
const fakeProvider = (id: string, category: 'whatsapp' | 'sms'): Connector => ({
  manifest: { id, category, displayName: id, logo: '', docsUrl: '', auth: { type: 'api_key' }, capabilities: ['msg.send', 'msg.inbound', 'msg.status', 'msg.templates'],
    credentialFields: [{ key: 'token', label: 'Token', type: 'secret', required: true }], configFields: [] },
  async verify() { return { ok: true }; }, async health() { return { ok: true }; },
  async send(_ctx, msg) {
    beh.calls++;
    if (beh.transport) throw new Error('network down');
    if (beh.reject) throw new MessageRejectedError(beh.reject, 'refused by provider');
    sent.push(msg); return { providerMessageId: `pm-${sent.length}-${Math.random().toString(36).slice(2, 7)}` };
  },
  async submitTemplate(_c, t) { return { providerTemplateId: `prov-${t.name}`, status: 'pending' }; },
  async syncTemplates() { return [{ providerTemplateId: 'prov-welcome', name: 'welcome', language: 'en', status: 'approved' as const, body: 'Hi {{1}}' }, { providerTemplateId: 'prov-remote', name: 'remote_only', language: 'en', status: 'approved' as const, body: 'Offer {{1}} for {{2}}' }]; },
});
const registry = new ConnectorRegistry().register(fakeProvider('fake-wa', 'whatsapp')).register(fakeProvider('fake-sms', 'sms'));
const clock = { t: new Date('2026-03-10T06:30:00Z') }; // 12:00 IST (outside quiet hours)
const svc = () => new MessagingService(db, keys, registry, () => clock.t);
const as = <T>(t: string, fn: () => Promise<T>) => runWithTenant(t, fn, { userId: '65f000000000000000000001' });
let phone = 9000000;
const nextPhone = () => `98${String(++phone).padStart(8, '0')}`;

async function mkTenant(slug: string, withChannels: ('whatsapp' | 'sms')[] = ['whatsapp', 'sms']) {
  const t: any = await runAsSystem('test', () => db.models.Tenant.create({ name: `${slug} Realty`, slug, country: 'IN', timezone: 'Asia/Kolkata' }));
  const id = String(t._id);
  await runWithTenant(id, async () => {
    await seedPreset(db.repos, 'generic');
    const conns = new ConnectionService(db, keys, registry);
    if (withChannels.includes('whatsapp')) await conns.create({ provider: 'fake-wa', name: 'WA', credentials: { token: 'wa-token-1234' } });
    if (withChannels.includes('sms')) await conns.create({ provider: 'fake-sms', name: 'SMS', credentials: { token: 'sms-token-1234' } });
  });
  return id;
}
const newLead = async (t: string, name = 'Asha Rao', p = nextPhone()) => ({ id: ((await as(t, () => leads.intake({ name, contacts: [{ value: p }], city: 'Pune' }))) as any).leadId as string, phone: `+91${p}` });
const approvedTpl = (t: string, ch: 'whatsapp' | 'sms', name: string, body: string, variables: string[], extra: any = {}) => as(t, async () => {
  const s = svc(); const tpl: any = await s.createTemplate({ channel: ch, name, body, variables, ...extra });
  if (ch === 'sms') { await s.updateTemplate(tpl._id, { dltTemplateId: '1107111', providerTemplateId: 'flow-1', dltHeader: 'ACMEIN', ...extra }); return s.approveSmsTemplate(String(tpl._id)); }
  await runWithTenant(t, () => db.repos.templates.updateOne({ _id: tpl._id }, { $set: { status: 'approved' } }));
  return db.repos.templates.findById(tpl._id);
}) as Promise<any>;
const inbound = (conn: any, from: string, body: string, id = `in-${Math.random()}`, ts = clock.t) => svc().handleInbound(conn, { kind: 'InboundMessage', from, providerMessageId: id, body, timestamp: ts, profileName: 'Inbound Person' });
const conn = (t: string, category: string) => runWithTenant(t, () => db.repos.connections.findOne({ category })) as Promise<any>;

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('msg_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  router = new TenantDbRouter(url); db = await router.connect(); keys = new LocalKeyService(randomBytes(32)); leads = new LeadService(db);
});
afterAll(async () => { await router.close(); await rs.stop(); });

describe('pure helpers', () => {
  it('STOP/START keywords are exact-ish, not substring matches', () => {
    for (const w of ['STOP', 'stop', ' Stop. ', 'stop all', 'UNSUBSCRIBE', 'Cancel', 'quit']) expect(isStopWord(w)).toBe(true);
    for (const w of ['please stop calling', 'stopping by tomorrow', 'I will not stop', 'ok']) expect(isStopWord(w)).toBe(false);
    expect(isStartWord('start')).toBe(true); expect(isStartWord('yes')).toBe(false);
  });
  it('renders {{1}} and {{name}} placeholders and never sends a hole', () => {
    expect(renderTemplate({ body: 'Hi {{1}}, {{2}} awaits', variables: ['first_name', 'project'] }, { first_name: 'Asha', project: 'Skyline' }).body).toBe('Hi Asha, Skyline awaits');
    expect(renderTemplate({ body: 'Hi {{first_name}}', variables: ['first_name'] }, { first_name: 'Ravi' }).values).toEqual(['Ravi']);
    expect(() => renderTemplate({ body: 'Hi {{1}} {{2}}', variables: ['a', 'b'] }, { a: 'x' })).toThrow(expect.objectContaining({ code: 'missing_template_variable', details: { b: 'value required' } }));
  });
});

describe('sending rules', () => {
  it('hides unconnected channels and refuses to send on them', async () => {
    const T = await mkTenant('nochan', []);
    expect(await as(T, () => svc().channels())).toMatchObject({ whatsapp: { connected: false }, sms: { connected: false } });
    const { id } = await newLead(T);
    await expect(as(T, () => svc().send({ leadId: id, channel: 'whatsapp', body: 'hi', idempotencyKey: 'k1' }))).rejects.toMatchObject({ code: 'channel_not_connected' });
    const T2 = await mkTenant('waonly', ['whatsapp']);
    const c = await as(T2, () => svc().channels());
    expect(c.whatsapp.connected).toBe(true); expect(c.sms.connected).toBe(false);
  });

  it('WhatsApp free text needs the 24h window; an inbound message opens it; it closes after 24h', async () => {
    const T = await mkTenant('window'); const l = await newLead(T);
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'hello', idempotencyKey: 'w1' }))).rejects.toMatchObject({ code: 'window_closed' });
    await as(T, async () => inbound(await conn(T, 'whatsapp'), l.phone, 'Hi, interested'));
    const ok = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'Great, calling you', idempotencyKey: 'w2' }));
    expect(ok.message.status).toBe('sent');
    clock.t = new Date(clock.t.getTime() + 25 * 3600_000);
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'still there?', idempotencyKey: 'w3' }))).rejects.toMatchObject({ code: 'window_closed' });
    clock.t = new Date('2026-03-10T06:30:00Z');
  });

  it('is idempotent: same key twice and 6 concurrent calls reach the provider once', async () => {
    const T = await mkTenant('idem'); const l = await newLead(T);
    await as(T, async () => inbound(await conn(T, 'whatsapp'), l.phone, 'hello'));
    const before = beh.calls;
    const a = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'one', idempotencyKey: 'same' }));
    const b = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'one', idempotencyKey: 'same' }));
    expect(b.duplicate).toBe(true); expect(String(b.message._id)).toBe(String(a.message._id));
    const rs2 = await Promise.all(Array.from({ length: 6 }, () => as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'two', idempotencyKey: 'burst' }))));
    expect(new Set(rs2.map((r: any) => String(r.message._id))).size).toBe(1);
    expect(beh.calls - before).toBe(2);
  });

  it('transport failure leaves the message retryable with the same key (no double send once it works)', async () => {
    const T = await mkTenant('retry'); const l = await newLead(T);
    await as(T, async () => inbound(await conn(T, 'whatsapp'), l.phone, 'hello'));
    beh.transport = true;
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'retry me', idempotencyKey: 'r1' }))).rejects.toThrow('network down');
    const row: any = await as(T, () => db.repos.messages.findOne({ idempotencyKey: 'r1' }));
    expect(row.status).toBe('queued'); expect(row.error).toMatch(/network down/);
    beh.transport = false;
    const again = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'retry me', idempotencyKey: 'r1' }));
    expect(again.message.status).toBe('sent');
    expect(await as(T, () => db.repos.messages.count({ idempotencyKey: 'r1' }))).toBe(1);
    const third = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'retry me', idempotencyKey: 'r1' }));
    expect(third.duplicate).toBe(true);
  });

  it('provider refusals mark the message failed and surface a clear reason', async () => {
    const T = await mkTenant('refuse'); const l = await newLead(T);
    await as(T, async () => inbound(await conn(T, 'whatsapp'), l.phone, 'hello'));
    beh.reject = 'window_closed';
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'x', idempotencyKey: 'f1' }))).rejects.toMatchObject({ code: 'window_closed' });
    beh.reject = null;
    expect(((await as(T, () => db.repos.messages.findOne({ idempotencyKey: 'f1' }))) as any).status).toBe('failed');
  });

  it('templates: only approved ones send; variables default from the lead and can be overridden; missing ones block', async () => {
    const T = await mkTenant('tpl'); const l = await newLead(T, 'Anita Desai');
    const draft: any = await as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'welcome', body: 'Hi {{1}}, this is {{2}} from {{3}}', variables: ['first_name', 'agent_name', 'company'] }));
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', templateId: String(draft._id), idempotencyKey: 't0' }))).rejects.toMatchObject({ code: 'template_not_approved' });
    const tpl = await approvedTpl(T, 'whatsapp', 'welcome2', 'Hi {{1}}, this is {{2}} from {{3}}', ['first_name', 'agent_name', 'company']);
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', templateId: String(tpl._id), idempotencyKey: 't1' }))).rejects.toMatchObject({ code: 'missing_template_variable', details: { agent_name: 'value required' } });
    const r = await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', templateId: String(tpl._id), vars: { agent_name: 'Ravi' }, idempotencyKey: 't2', actorName: 'Ravi' }));
    expect(r.message.body).toBe('Hi Anita, this is Ravi from tpl Realty');
    expect(sent.at(-1)).toMatchObject({ template: { name: 'welcome2', language: 'en', variables: ['Anita', 'Ravi', 'tpl Realty'] } });
    expect(sent.at(-1).body).toBeUndefined();
  });

  it('SMS: free text is blocked, templates need DLT ids, approval is refused until DLT identifiers exist', async () => {
    const T = await mkTenant('sms'); const l = await newLead(T);
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'sms', body: 'hi', idempotencyKey: 's0' }))).rejects.toMatchObject({ code: 'dlt_template_required' });
    const t: any = await as(T, () => svc().createTemplate({ channel: 'sms', name: 'visit', body: 'Hi {{1}}, your visit is confirmed', variables: ['first_name'] }));
    await expect(as(T, () => svc().approveSmsTemplate(String(t._id)))).rejects.toMatchObject({ code: 'dlt_incomplete', details: { dltTemplateId: expect.any(String), providerTemplateId: expect.any(String), dltHeader: expect.any(String) } });
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'sms', templateId: String(t._id), idempotencyKey: 's1' }))).rejects.toMatchObject({ code: 'template_not_approved' });
    const ok = await approvedTpl(T, 'sms', 'visit2', 'Hi {{1}}, your visit is confirmed', ['first_name']);
    const r = await as(T, () => svc().send({ leadId: l.id, channel: 'sms', templateId: String(ok._id), idempotencyKey: 's2' }));
    expect(r.message.status).toBe('sent');
    expect(sent.at(-1).template).toMatchObject({ providerTemplateId: 'flow-1', dltTemplateId: '1107111', header: 'ACMEIN', variables: ['Asha'] });
    await expect(as(T, () => svc().submitTemplate(String(ok._id)))).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('automated sends respect quiet hours and a per-lead daily cap; agent sends do not', async () => {
    const T = await mkTenant('auto'); const l = await newLead(T);
    const tpl = await approvedTpl(T, 'whatsapp', 'nudge', 'Hi {{1}}', ['first_name']);
    const go = (key: string, source: any) => as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', templateId: String(tpl._id), idempotencyKey: key, source }));
    clock.t = new Date('2026-03-10T17:30:00Z'); // 23:00 IST
    await expect(go('q1', 'cadence')).rejects.toMatchObject({ code: 'quiet_hours', details: { until: '09:00' } });
    expect((await go('q2', 'agent')).message.status).toBe('sent');
    clock.t = new Date('2026-03-10T06:30:00Z');
    for (let n = 0; n < 3; n++) expect((await go(`cap${n}`, n % 2 ? 'cadence' : 'first_touch')).message.status).toBe('sent');
    await expect(go('cap3', 'cadence')).rejects.toMatchObject({ code: 'frequency_cap', status: 429 });
    expect((await go('agent-ok', 'agent')).message.status).toBe('sent');
  });

  it("another tenant cannot send for, read or template-share across tenants", async () => {
    const A = await mkTenant('isoA'); const B = await mkTenant('isoB');
    const la = await newLead(A); await as(A, async () => inbound(await conn(A, 'whatsapp'), la.phone, 'hi'));
    const tplA = await approvedTpl(A, 'whatsapp', 'secret_tpl', 'Hello {{1}}', ['first_name']);
    await expect(as(B, () => svc().send({ leadId: la.id, channel: 'whatsapp', body: 'x', idempotencyKey: 'x1' }))).rejects.toThrow('Lead not found');
    const lb = await newLead(B); await as(B, async () => inbound(await conn(B, 'whatsapp'), lb.phone, 'hi'));
    await expect(as(B, () => svc().send({ leadId: lb.id, channel: 'whatsapp', templateId: String(tplA._id), idempotencyKey: 'x2' }))).rejects.toThrow('Template not found');
    expect(await as(B, () => db.repos.templates.count())).toBe(0);
  });
});

describe('inbound, opt-out and statuses', () => {
  it('an unknown sender becomes a lead; duplicates are ignored; unread and window update', async () => {
    const T = await mkTenant('inb'); const c = await conn(T, 'whatsapp');
    const from = `+91${nextPhone()}`;
    const r1: any = await as(T, () => inbound(c, from, 'Is the 3BHK available?', 'in-1'));
    expect(r1.leadId).toBeTruthy();
    const lead: any = await as(T, () => leads.get(r1.leadId));
    expect(lead.displayName).toBe('Inbound Person');
    expect(await as(T, () => inbound(c, from, 'Is the 3BHK available?', 'in-1'))).toEqual({ duplicate: true });
    await as(T, () => inbound(c, from, 'Hello?', 'in-2'));
    const conv: any = (await as(T, () => svc().conversations(r1.leadId)))[0];
    expect(conv.unreadCount).toBe(2);
    expect(new Date(conv.windowExpiresAt).getTime()).toBe(clock.t.getTime() + 24 * 3600_000);
    expect((await as(T, () => leads.timeline(r1.leadId))).items.filter((a: any) => a.type === 'message_in')).toHaveLength(2);
    expect(await as(T, () => db.repos.outbox.count({ type: 'message.in', aggregateId: r1.leadId }))).toBe(2);
    await as(T, () => svc().markRead(String(conv._id)));
    expect(((await as(T, () => svc().conversations(r1.leadId)))[0] as any).unreadCount).toBe(0);
    // the same number in another tenant is a different lead
    const T2 = await mkTenant('inb2'); const r2: any = await as(T2, async () => inbound(await conn(T2, 'whatsapp'), from, 'hi', 'in-1'));
    expect(r2.leadId).not.toBe(r1.leadId);
  });

  it('STOP opts out immediately (per number+channel), blocks sends, is logged; START restores', async () => {
    const T = await mkTenant('stop'); const c = await conn(T, 'whatsapp'); const l = await newLead(T);
    await as(T, () => inbound(c, l.phone, 'STOP', 'st-1'));
    const lead: any = await as(T, () => leads.get(l.id));
    expect(lead.contacts.find((x: any) => x.kind === 'phone').optedOutChannels).toEqual(['whatsapp']);
    await expect(as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'x', idempotencyKey: 'o1' }))).rejects.toMatchObject({ code: 'opted_out' });
    const tl = (await as(T, () => leads.timeline(l.id))).items;
    expect(tl.some((a: any) => a.type === 'field_changed' && a.payload.reason === 'STOP keyword')).toBe(true);
    expect(await as(T, () => db.repos.outbox.count({ type: 'lead.opted_out' }))).toBe(1);
    expect(await as(T, () => db.repos.outbox.count({ type: 'message.in' }))).toBe(0); // a STOP is not a "reply" to chase
    await as(T, () => inbound(c, l.phone, 'start', 'st-2'));
    expect((await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'welcome back', idempotencyKey: 'o2' }))).message.status).toBe('sent');
  });

  it('statuses only move forward, tolerate out-of-order delivery and unknown ids', async () => {
    const T = await mkTenant('stat'); const l = await newLead(T);
    await as(T, async () => inbound(await conn(T, 'whatsapp'), l.phone, 'hi'));
    const m: any = (await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'x', idempotencyKey: 'st' }))).message;
    const st = (status: any, error?: string) => as(T, () => svc().handleStatus({ kind: 'MessageStatus', providerMessageId: m.providerMessageId, status, error }));
    expect(await st('read')).toEqual({ status: 'read' });
    expect(await st('delivered')).toEqual({ unchanged: true });
    expect(await st('failed', 'late')).toEqual({ unchanged: true });
    expect(((await as(T, () => db.repos.messages.findById(m._id))) as any).status).toBe('read');
    expect(await as(T, () => svc().handleStatus({ kind: 'MessageStatus', providerMessageId: 'nope', status: 'delivered' }))).toEqual({ unknown: true });
    const m2: any = (await as(T, () => svc().send({ leadId: l.id, channel: 'whatsapp', body: 'y', idempotencyKey: 'st2' }))).message;
    await as(T, () => svc().handleStatus({ kind: 'MessageStatus', providerMessageId: m2.providerMessageId, status: 'failed', error: 'not on WhatsApp' }));
    const failed: any = await as(T, () => db.repos.messages.findById(m2._id));
    expect(failed).toMatchObject({ status: 'failed', error: 'not on WhatsApp' });
    expect((await as(T, () => leads.timeline(l.id))).items.some((a: any) => a.type === 'message_status')).toBe(true);
  });

  it('flows through the inbox pipeline end to end (webhook row -> canonical event -> messaging)', async () => {
    const T = await mkTenant('pipe');
    // a provider that parses our own row shape
    const reg = new ConnectorRegistry().register({ ...fakeProvider('fake-wa', 'whatsapp'), async parseWebhook(raw: any) { return [{ kind: 'InboundMessage', from: raw.from, providerMessageId: raw.id, body: raw.text, timestamp: new Date(), profileName: 'Pipe Person' }]; } });
    const c: any = await runWithTenant(T, () => db.repos.connections.findOne({ category: 'whatsapp' }));
    const row: any = await runWithTenant(T, () => db.repos.inbox.create({ connectionId: c._id, provider: 'fake-wa', externalEventId: 'ev1', rawPayload: { from: `+91${nextPhone()}`, id: 'pipe-1', text: 'Hello from pipeline' }, signatureValid: true }));
    const inbox = new InboxService(db, reg, 8, keys);
    const out = await runWithTenant(T, () => inbox.process(String(row._id)));
    expect(out.status).toBe('done');
    expect(await runWithTenant(T, () => db.repos.messages.count({ providerMessageId: 'pipe-1' }))).toBe(1);
    expect(await runWithTenant(T, () => inbox.process(String(row._id)))).toMatchObject({ status: 'done' }); // idempotent redelivery
  });
});

describe('template lifecycle', () => {
  it('validates, submits (WhatsApp), reacts to provider status events, syncs, and freezes approved templates', async () => {
    const T = await mkTenant('life');
    await expect(as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'Bad Name', body: 'x' }))).rejects.toMatchObject({ code: 'invalid_template', details: { name: expect.any(String) } });
    await expect(as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'ok', body: 'Hi {{3}}', variables: ['a'] }))).rejects.toMatchObject({ code: 'invalid_template', details: { variables: expect.any(String) } });
    await expect(as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'mix', body: 'Hi {{1}} {{name}}', variables: ['name'] }))).rejects.toMatchObject({ code: 'invalid_template' });
    const t: any = await as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'welcome', body: 'Hi {{1}}', variables: ['first_name'] }));
    await expect(as(T, () => svc().createTemplate({ channel: 'whatsapp', name: 'welcome', body: 'dup' }))).rejects.toMatchObject({ code: 'duplicate_template' });
    const sub: any = await as(T, () => svc().submitTemplate(String(t._id)));
    expect(sub).toMatchObject({ status: 'pending', providerTemplateId: 'prov-welcome' });
    await expect(as(T, () => svc().updateTemplate(String(t._id), { body: 'changed' }))).rejects.toMatchObject({ code: 'invalid_state' });
    const c = await conn(T, 'whatsapp');
    await as(T, () => svc().handleTemplateStatus(c, { kind: 'TemplateStatus', providerTemplateId: 'prov-welcome', status: 'rejected', reason: 'INCORRECT_CATEGORY' }));
    expect(((await as(T, () => db.repos.templates.findById(t._id))) as any)).toMatchObject({ status: 'rejected', rejectionReason: 'INCORRECT_CATEGORY' });
    await as(T, () => svc().updateTemplate(String(t._id), { body: 'Hello {{1}}' })); // rejected -> editable draft again
    await as(T, () => svc().submitTemplate(String(t._id)));
    const sync = await as(T, () => svc().syncTemplates());
    expect(sync).toEqual({ updated: 1, imported: 1 });
    const after: any = await as(T, () => db.repos.templates.findById(t._id));
    expect(after.status).toBe('approved');
    const imported: any = await as(T, () => db.repos.templates.findOne({ name: 'remote_only' }));
    expect(imported).toMatchObject({ status: 'approved', variables: ['var1', 'var2'], providerTemplateId: 'prov-remote' });
    await expect(as(T, () => svc().updateTemplate(String(t._id), { body: 'sneaky edit' }))).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('regressions', () => {
  it('a partial template patch with explicit undefined fields (as DTOs produce) keeps the rest intact', async () => {
    const T = await mkTenant('patch');
    const t: any = await as(T, () => svc().createTemplate({ channel: 'sms', name: 'p1', body: 'Hi {{1}}', variables: ['first_name'] }));
    const u: any = await as(T, () => svc().updateTemplate(String(t._id), { body: undefined, dltTemplateId: '123', variables: undefined }));
    expect(u).toMatchObject({ body: 'Hi {{1}}', dltTemplateId: '123', variables: ['first_name'] });
  });
});
