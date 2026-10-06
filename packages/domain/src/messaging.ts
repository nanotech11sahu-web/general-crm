import { MessageRejectedError, type CanonicalEvent, type ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { getContext, requireTenantId, toObjectId, type TenantDb } from '@leaddesk/db';
import { ConnectionService } from './connections';
import { DomainError, notFound } from './errors';
import { LeadService } from './lead-service';
import { inTimeWindow } from './routing';

export type Channel = 'whatsapp' | 'sms' | 'email';
export type MsgSource = 'agent' | 'cadence' | 'first_touch' | 'inbound' | 'system';
const WINDOW_MS = 24 * 3600_000;
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

const norm = (b: string) => b.trim().toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, '');
export const isStopWord = (b: string) => ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT'].includes(norm(b));
export const isStartWord = (b: string) => ['START', 'UNSTOP', 'SUBSCRIBE'].includes(norm(b));

export interface MessagingSettings { autoPerLeadPerDay: number; quietHours: { from: string; to: string } | null }
const DEFAULTS: MessagingSettings = { autoPerLeadPerDay: 3, quietHours: { from: '21:00', to: '09:00' } };

/** `{{1}}` / `{{name}}` placeholders -> values. Missing values are an error, never an empty hole in a customer message. */
export function renderTemplate(t: { body: string; variables: string[] }, values: Record<string, string>) {
  const missing: Record<string, string> = {};
  const ordered = t.variables.map((v) => { const x = (values[v] ?? '').trim(); if (!x) missing[v] = 'value required'; return x; });
  if (Object.keys(missing).length) throw new DomainError('missing_template_variable', 'Fill in every template variable', missing);
  let body = t.body;
  t.variables.forEach((v, i) => { body = body.split(`{{${i + 1}}}`).join(ordered[i]).split(`{{${v}}}`).join(ordered[i]); });
  return { body, values: ordered };
}

export class MessagingService {
  private readonly conns: ConnectionService;
  private readonly leads: LeadService;
  constructor(private readonly db: TenantDb, keys: KeyService, private readonly registry: ConnectorRegistry, private readonly now: () => Date = () => new Date()) {
    this.conns = new ConnectionService(db, keys, registry);
    this.leads = new LeadService(db);
  }
  private get r() { return this.db.repos; }

  private async tenant(): Promise<any> { return this.db.models.Tenant.findById(requireTenantId()).lean().exec(); }
  async settings(): Promise<MessagingSettings & { tz: string }> {
    const t = await this.tenant();
    return { ...DEFAULTS, ...(t?.settings?.messaging ?? {}), tz: t?.timezone ?? 'Asia/Kolkata' };
  }

  /** A channel is usable when a live connection with `msg.send` exists. Missing channels are simply hidden in the UI. */
  async channels(): Promise<Record<Channel, { connected: boolean; connectionId?: string }>> {
    const out: Record<Channel, { connected: boolean; connectionId?: string }> = { whatsapp: { connected: false }, sms: { connected: false }, email: { connected: false } };
    for (const c of (await this.r.connections.find({ status: { $in: ['verified', 'degraded'] } })) as any[]) {
      const cap = this.registry.get(c.provider)?.manifest.capabilities ?? [];
      const ch = c.category as Channel;
      if (ch in out && cap.includes('msg.send') && !out[ch].connected) out[ch] = { connected: true, connectionId: String(c._id) };
    }
    return out;
  }

  private async connectionFor(channel: Channel) {
    const id = (await this.channels())[channel].connectionId;
    if (!id) throw new DomainError('channel_not_connected', `${channel} is not connected for this workspace`, undefined, 409);
    return (await this.r.connections.findById(id)) as any;
  }

  private defaultValues(lead: any, tenantName: string, actorName?: string): Record<string, string> {
    const first = String(lead.displayName ?? '').split(/\s+/)[0] ?? '';
    const custom = Object.fromEntries(Object.entries(lead.custom ?? {}).map(([k, v]) => [k, String(v)]));
    return { first_name: first, name: lead.displayName ?? '', city: lead.city ?? '', agent_name: actorName ?? '', company: tenantName, ...custom };
  }

  /**
   * The only way a message leaves the platform. Order of checks: channel connected -> contact + opt-out ->
   * automated-send guards -> window/DLT/template rules -> idempotent row -> provider call.
   */
  async send(i: { leadId: string; channel: Channel; templateId?: string; body?: string; vars?: Record<string, string>; idempotencyKey: string; source?: MsgSource; actorName?: string }) {
    const source = i.source ?? 'agent';
    const lead: any = await this.leads.get(i.leadId);
    const conn = await this.connectionFor(i.channel);
    const connector = this.registry.get(conn.provider);
    if (!connector?.send) throw new DomainError('channel_not_connected', 'This connection cannot send messages');
    const contact = (lead.contacts ?? []).find((c: any) => c.kind === 'phone');
    if (!contact) throw new DomainError('no_phone', 'This lead has no phone number');
    if ((lead.contacts ?? []).some((c: any) => c.kind === 'phone' && (c.optedOutChannels ?? []).includes(i.channel))) throw new DomainError('opted_out', `This lead opted out of ${i.channel} messages`, undefined, 409);

    const existing: any = await this.r.messages.findOne({ idempotencyKey: i.idempotencyKey });
    if (existing && existing.status !== 'queued') return { message: existing, duplicate: true };

    const s = await this.settings();
    if (source === 'cadence' || source === 'first_touch') {
      if (s.quietHours && inTimeWindow(this.now(), s.tz, s.quietHours.from, s.quietHours.to)) throw new DomainError('quiet_hours', 'Automated messages are paused during quiet hours', { until: s.quietHours.to }, 409);
      const since = new Date(this.now().getTime() - 24 * 3600_000);
      const sent = await this.r.messages.count({ leadId: lead._id, direction: 'out', source: { $in: ['cadence', 'first_touch'] }, createdAt: { $gte: since }, status: { $ne: 'failed' } });
      if (sent >= s.autoPerLeadPerDay) throw new DomainError('frequency_cap', `At most ${s.autoPerLeadPerDay} automated messages per lead per day`, undefined, 429);
    }

    const conv = await this.conversation(lead, i.channel, conn, contact.valueNorm);
    let tpl: any; let body = i.body?.trim() ?? ''; let values: string[] = [];
    if (i.templateId) {
      tpl = await this.r.templates.findById(i.templateId);
      if (!tpl || tpl.channel !== i.channel) throw notFound('Template');
      if (tpl.status !== 'approved') throw new DomainError('template_not_approved', `Template is ${tpl.status}; only approved templates can be sent`, undefined, 409);
      if (tpl.connectionId && String(tpl.connectionId) !== String(conn._id)) throw new DomainError('template_wrong_connection', 'Template belongs to a different connection');
      if (i.channel === 'sms' && !tpl.dltTemplateId) throw new DomainError('dlt_template_required', 'SMS in India needs an approved DLT template with its DLT template id', undefined, 409);
      const t = await this.tenant();
      ({ body, values } = renderTemplate(tpl, { ...this.defaultValues(lead, t?.name ?? '', i.actorName), ...(i.vars ?? {}) }));
    } else {
      if (i.channel === 'sms') throw new DomainError('dlt_template_required', 'SMS can only be sent from an approved DLT template', undefined, 409);
      if (!body) throw new DomainError('empty_message', 'Write a message or pick a template');
      if (i.channel === 'whatsapp' && !(conv.windowExpiresAt && new Date(conv.windowExpiresAt) > this.now())) throw new DomainError('window_closed', 'The 24-hour reply window is closed: send an approved template instead', undefined, 409);
    }

    let msg: any;
    const lease = new Date(this.now().getTime() + 60_000);
    if (existing) {
      // a previous attempt hit a transport error before the provider accepted it: retry the same row, one caller at a time
      msg = await this.r.messages.findOneAndUpdate({ _id: existing._id, status: 'queued', $or: [{ sendingUntil: null }, { sendingUntil: { $lt: this.now() } }] }, { $set: { sendingUntil: lease } }, { new: true });
      if (!msg) return { message: existing, duplicate: true, inFlight: true };
    } else {
      try {
        msg = await this.r.messages.create({ conversationId: conv._id, leadId: lead._id, direction: 'out', channel: i.channel, body, templateId: tpl?._id, source, status: 'queued', sentBy: getContext()?.userId ? toObjectId(getContext()!.userId!) : undefined, idempotencyKey: i.idempotencyKey, sendingUntil: lease });
      } catch (e: any) {
        if (e?.code === 11000) return { message: await this.r.messages.findOne({ idempotencyKey: i.idempotencyKey }), duplicate: true, inFlight: true }; // concurrent duplicate
        throw e;
      }
    }
    try {
      const res = await connector.send(this.conns.contextFor(conn), { to: contact.valueNorm, channel: i.channel, body: tpl ? undefined : body, template: tpl ? { name: tpl.name, language: tpl.language, variables: values, providerTemplateId: tpl.providerTemplateId, dltTemplateId: tpl.dltTemplateId, header: tpl.dltHeader } : undefined });
      await this.r.messages.updateOne({ _id: msg._id }, { $set: { status: 'sent', providerMessageId: res.providerMessageId, sendingUntil: null } });
      await this.r.conversations.updateOne({ _id: conv._id }, { $set: { lastMessageAt: this.now(), lastMessagePreview: body.slice(0, 80) } });
      await this.activity(lead._id, 'message_out', { channel: i.channel, messageId: String(msg._id), templateId: tpl ? String(tpl._id) : undefined, source, preview: body.slice(0, 120) }, i.channel);
      return { message: await this.r.messages.findById(msg._id), duplicate: false };
    } catch (e: any) {
      const reason = String(e?.message ?? e).slice(0, 300);
      if (e instanceof MessageRejectedError) {
        await this.r.messages.updateOne({ _id: msg._id }, { $set: { status: 'failed', error: reason, sendingUntil: null } });
        throw new DomainError(e.code, reason, undefined, 409);
      }
      // transport problem: leave the row `queued` so the caller (or queue) can retry with the same idempotency key
      await this.r.messages.updateOne({ _id: msg._id }, { $set: { error: reason, sendingUntil: null } });
      throw e;
    }
  }

  private async activity(leadId: unknown, type: string, payload: Record<string, unknown>, channel?: string) {
    await this.r.activities.create({ leadId, type, actorId: getContext()?.userId, channel, payload, occurredAt: this.now() });
  }

  private async conversation(lead: any, channel: Channel, conn: any, thread: string) {
    return this.r.conversations.findOneAndUpdate({ leadId: lead._id, channel, connectionId: conn._id }, { $setOnInsert: { leadId: lead._id, channel, connectionId: conn._id, externalThreadId: thread, unreadCount: 0 } }, { upsert: true, new: true }) as Promise<any>;
  }

  // ---------------- inbound events (from the inbox pipeline) ----------------
  async handleEvent(conn: any, e: CanonicalEvent, hooks: { onInbound?: (leadId: string, reason: 'reply' | 'stop') => Promise<void> } = {}) {
    if (e.kind === 'InboundMessage') return this.handleInbound(conn, e, hooks);
    if (e.kind === 'MessageStatus') return this.handleStatus(e);
    if (e.kind === 'TemplateStatus') return this.handleTemplateStatus(conn, e);
    return null;
  }

  async handleInbound(conn: any, e: Extract<CanonicalEvent, { kind: 'InboundMessage' }>, hooks: { onInbound?: (leadId: string, reason: 'reply' | 'stop') => Promise<void> } = {}) {
    const channel = conn.category as Channel;
    if (await this.r.messages.findOne({ providerMessageId: e.providerMessageId })) return { duplicate: true };
    let hit: any = await this.r.leads.findOne({ 'contacts.valueNorm': e.from, deletedAt: null });
    if (!hit) {
      const out = await this.leads.intake({ name: e.profileName || e.from, contacts: [{ value: e.from, kind: 'phone' }], source: { kind: channel, name: conn.name } });
      if (out.outcome === 'rejected') throw new DomainError('rejected', `Inbound message from an unusable number: ${out.reason}`);
      hit = await this.r.leads.findById(out.leadId);
    }
    const conv = await this.conversation(hit, channel, conn, e.from);
    try {
      await this.r.messages.create({ conversationId: conv._id, leadId: hit._id, direction: 'in', channel, body: e.body, providerMessageId: e.providerMessageId, source: 'inbound', status: 'received', media: e.mediaType ? { type: e.mediaType } : undefined, createdAt: e.timestamp });
    } catch (err: any) { if (err?.code === 11000) return { duplicate: true }; throw err; }
    const set: Record<string, unknown> = { lastMessageAt: e.timestamp, lastInboundAt: e.timestamp, lastMessagePreview: e.body.slice(0, 80) };
    if (channel === 'whatsapp') set.windowExpiresAt = new Date(Math.max(new Date(conv.windowExpiresAt ?? 0).getTime(), e.timestamp.getTime() + WINDOW_MS));
    await this.r.conversations.updateOne({ _id: conv._id }, { $set: set, $inc: { unreadCount: 1 } });
    await this.activity(hit._id, 'message_in', { channel, preview: e.body.slice(0, 120), media: e.mediaType }, channel);

    const stop = isStopWord(e.body);
    if (stop || isStartWord(e.body)) {
      await this.setOptOut(hit, e.from, channel, stop);
      await this.r.outbox.add(stop ? 'lead.opted_out' : 'lead.opted_in', String(hit._id), { channel });
      if (stop) await hooks.onInbound?.(String(hit._id), 'stop');
    } else {
      await this.r.outbox.add('message.in', String(hit._id), { channel, conversationId: String(conv._id), ownerId: hit.ownerId ? String(hit.ownerId) : null });
      await hooks.onInbound?.(String(hit._id), 'reply');
    }
    return { duplicate: false, leadId: String(hit._id), stop };
  }

  /** STOP/START per phone number and channel. Opt-outs are honoured immediately and recorded on the timeline. */
  private async setOptOut(lead: any, phone: string, channel: Channel, out: boolean) {
    const contacts = (lead.contacts ?? []).map((c: any) => c.kind === 'phone' && c.valueNorm === phone
      ? { ...c, optedOutChannels: out ? [...new Set([...(c.optedOutChannels ?? []), channel])] : (c.optedOutChannels ?? []).filter((x: string) => x !== channel) } : c);
    await this.r.leads.updateOne({ _id: lead._id }, { $set: { contacts } });
    await this.activity(lead._id, 'field_changed', { changes: { [`optOut.${channel}`]: { from: !out, to: out } }, reason: out ? 'STOP keyword' : 'START keyword' }, channel);
  }

  async handleStatus(e: Extract<CanonicalEvent, { kind: 'MessageStatus' }>) {
    const m: any = await this.r.messages.findOne({ providerMessageId: e.providerMessageId });
    if (!m) return { unknown: true };
    const cur = m.status as string;
    let next: string | null = null;
    if (e.status === 'failed') next = cur === 'queued' || cur === 'sent' ? 'failed' : null; // a delivered message cannot later "fail"
    else if ((RANK[e.status] ?? -1) > (RANK[cur] ?? -1)) next = e.status;                    // forward-only: out-of-order webhooks are harmless
    if (!next) return { unchanged: true };
    await this.r.messages.updateOne({ _id: m._id }, { $set: { status: next, ...(next === 'failed' ? { error: e.error ?? 'delivery failed' } : {}) } });
    if (next === 'failed') await this.activity(m.leadId, 'message_status', { messageId: String(m._id), status: 'failed', error: e.error }, m.channel);
    return { status: next };
  }

  async handleTemplateStatus(conn: any, e: Extract<CanonicalEvent, { kind: 'TemplateStatus' }>) {
    const filter: Record<string, unknown> = { connectionId: conn._id };
    if (e.providerTemplateId) filter.providerTemplateId = e.providerTemplateId; else { filter.name = e.name; filter.language = e.language; }
    const t: any = await this.r.templates.findOne(filter);
    if (!t) return { unknown: true };
    await this.r.templates.updateOne({ _id: t._id }, { $set: { status: e.status, rejectionReason: e.status === 'rejected' ? e.reason ?? 'rejected by WhatsApp' : null } });
    return { status: e.status };
  }

  // ---------------- conversations ----------------
  async conversations(leadId: string) { return this.r.conversations.find({ leadId: toObjectId(leadId) }, { sort: { lastMessageAt: -1 } }); }
  async messages(conversationId: string, limit = 100) {
    const c: any = await this.r.conversations.findById(conversationId);
    if (!c) throw notFound('Conversation');
    return { conversation: c, items: await this.r.messages.find({ conversationId: c._id }, { sort: { createdAt: 1 }, limit: Math.min(limit, 500) }) };
  }
  async markRead(conversationId: string) { await this.r.conversations.updateOne({ _id: conversationId }, { $set: { unreadCount: 0 } }); }

  // ---------------- templates ----------------
  private checkTemplate(t: { channel: string; body: string; variables?: string[]; name: string }) {
    const errors: Record<string, string> = {};
    if (!/^[a-z0-9_]{1,60}$/.test(t.name)) errors.name = 'lowercase letters, digits and underscores only';
    if (!t.body?.trim() || t.body.length > 1024) errors.body = 'required, up to 1024 characters';
    const nums = [...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const vars = t.variables ?? [];
    if (nums.some((n) => /^\d+$/.test(n)) && nums.some((n) => !/^\d+$/.test(n))) errors.body = 'use either {{1}} style or {{name}} style placeholders, not both';
    for (const n of new Set(nums)) if (/^\d+$/.test(n) ? Number(n) > vars.length || Number(n) < 1 : !vars.includes(n)) errors.variables = `placeholder {{${n}}} has no matching variable`;
    if (Object.keys(errors).length) throw new DomainError('invalid_template', 'Invalid template', errors);
  }

  async createTemplate(i: { channel: Channel; name: string; body: string; variables?: string[]; language?: string; category?: string; dltTemplateId?: string; dltHeader?: string; providerTemplateId?: string; connectionId?: string }) {
    this.checkTemplate(i);
    try {
      return await this.r.templates.create({ ...i, variables: i.variables ?? [], language: i.language ?? 'en', category: i.category ?? 'utility', connectionId: i.connectionId ? toObjectId(i.connectionId) : undefined, status: 'draft' });
    } catch (e: any) { if (e?.code === 11000) throw new DomainError('duplicate_template', 'A template with this name and language already exists'); throw e; }
  }

  async updateTemplate(id: string, patch: Partial<{ body: string; variables: string[]; category: string; dltTemplateId: string; dltHeader: string; providerTemplateId: string }>) {
    const t: any = await this.r.templates.findById(id);
    if (!t) throw notFound('Template');
    if (t.status === 'pending' || (t.status === 'approved' && t.channel === 'whatsapp')) throw new DomainError('invalid_state', 'Approved/pending WhatsApp templates are immutable: create a new version');
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)); // DTOs carry explicit undefineds
    this.checkTemplate({ ...t, ...clean });
    await this.r.templates.updateOne({ _id: t._id }, { $set: { ...clean, status: 'draft', rejectionReason: null } });
    return this.r.templates.findById(id);
  }

  /** WhatsApp: send the draft to Meta for review. */
  async submitTemplate(id: string) {
    const t: any = await this.r.templates.findById(id);
    if (!t) throw notFound('Template');
    if (t.channel !== 'whatsapp') throw new DomainError('invalid_state', 'Only WhatsApp templates are submitted to the provider; SMS templates are approved via DLT');
    if (!['draft', 'rejected'].includes(t.status)) throw new DomainError('invalid_state', `Template is ${t.status}`);
    const conn = await this.connectionFor('whatsapp');
    const connector = this.registry.get(conn.provider);
    if (!connector?.submitTemplate) throw new DomainError('channel_not_connected', 'This connection cannot submit templates');
    const sample = t.variables.map((v: string) => ({ first_name: 'Asha', name: 'Asha Rao', city: 'Pune', agent_name: 'Ravi', company: 'Acme' } as Record<string, string>)[v] ?? 'sample');
    const res = await connector.submitTemplate(this.conns.contextFor(conn), { name: t.name, language: t.language, category: t.category, body: t.body, sampleValues: sample });
    await this.r.templates.updateOne({ _id: t._id }, { $set: { providerTemplateId: res.providerTemplateId, status: res.status, connectionId: conn._id, rejectionReason: null } });
    return this.r.templates.findById(id);
  }

  /**
   * SMS/DLT: approval happens on the DLT portal, off-platform. An admin records it here; we refuse unless
   * every identifier the provider needs is present.
   */
  async approveSmsTemplate(id: string) {
    const t: any = await this.r.templates.findById(id);
    if (!t) throw notFound('Template');
    if (t.channel !== 'sms') throw new DomainError('invalid_state', 'Only SMS templates are approved manually');
    const errors: Record<string, string> = {};
    if (!t.dltTemplateId) errors.dltTemplateId = 'the DLT template id is required';
    if (!t.providerTemplateId) errors.providerTemplateId = 'the SMS provider template id is required';
    if (!t.dltHeader) errors.dltHeader = 'the DLT header (sender id) is required';
    if (Object.keys(errors).length) throw new DomainError('dlt_incomplete', 'Cannot approve without DLT identifiers', errors);
    const conn = await this.connectionFor('sms');
    await this.r.templates.updateOne({ _id: t._id }, { $set: { status: 'approved', connectionId: conn._id } });
    return this.r.templates.findById(id);
  }

  /** Pull template statuses from the provider and update ours (webhooks do the same in real time). */
  async syncTemplates() {
    const conn = await this.connectionFor('whatsapp');
    const connector = this.registry.get(conn.provider);
    if (!connector?.syncTemplates) throw new DomainError('channel_not_connected', 'This connection cannot sync templates');
    const remote = await connector.syncTemplates(this.conns.contextFor(conn));
    let updated = 0, imported = 0;
    for (const p of remote) {
      const t: any = await this.r.templates.findOne({ channel: 'whatsapp', name: p.name, language: p.language });
      if (t) { await this.r.templates.updateOne({ _id: t._id }, { $set: { status: p.status, providerTemplateId: p.providerTemplateId, connectionId: conn._id, rejectionReason: p.reason ?? null } }); updated++; }
      else if (p.body) {
        const nums = [...new Set([...p.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
        await this.r.templates.create({ channel: 'whatsapp', name: p.name, language: p.language, body: p.body, variables: nums.map((n) => `var${n}`), category: p.category || 'utility', status: p.status, providerTemplateId: p.providerTemplateId, connectionId: conn._id, rejectionReason: p.reason }); imported++;
      }
    }
    return { updated, imported };
  }
}
