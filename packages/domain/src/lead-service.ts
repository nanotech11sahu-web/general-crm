import { getContext, newObjectId, requireTenantId, toObjectId, withTransaction, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { RoutingService } from './routing';
import { cleanName, nameTokens, normalizeContacts, phoneSearchKeys, type NormContact, type RawContact } from './normalize';

export interface IntakeInput {
  name?: string;
  contacts: RawContact[];
  source?: { kind: string; name: string };
  campaign?: string; adSet?: string; ad?: string; formName?: string;
  externalRef?: string;
  metaLeadId?: string;
  /** Unmapped provider answers; kept on the timeline entry so nothing a lead typed is lost. */
  raw?: Record<string, string>;
  ownerId?: string;
  city?: string; language?: string; budgetText?: string;
  /** 0-100; set by scoring (rules/AI) so routing can use it at creation time. */
  score?: number;
  tags?: string[];
  custom?: Record<string, unknown>;
}
export type DedupePolicy = 'merge' | 'skip' | 'overwrite';
export type IntakeResult =
  | { outcome: 'created' | 'merged' | 'skipped' | 'duplicate_event'; leadId: string }
  | { outcome: 'rejected'; reason: string; invalid?: { value: string; reason: string }[] };

const isDup = (e: any) => e?.code === 11000 || /E11000/.test(String(e?.message));
const MERGE_UNDO_DAYS = 30;

/** Non-throwing so dry runs, imports and the API all apply identical rules. */
export function customFieldErrors(defs: any[], custom: Record<string, unknown>): Record<string, string> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom)) {
    const d = byKey.get(k);
    if (!d) { errors[k] = 'unknown field'; continue; }
    if (v === null || v === '') continue;
    if (d.type === 'number' && (typeof v !== 'number' || Number.isNaN(v))) errors[k] = 'must be a number';
    if (d.type === 'boolean' && typeof v !== 'boolean') errors[k] = 'must be true/false';
    if (d.type === 'text' && typeof v !== 'string') errors[k] = 'must be text';
    if (d.type === 'date' && Number.isNaN(Date.parse(String(v)))) errors[k] = 'must be a date';
    if (d.type === 'select' && !d.options.includes(String(v))) errors[k] = `must be one of ${d.options.join(', ')}`;
  }
  return errors;
}

export class LeadService {
  private readonly routing: RoutingService;
  constructor(private readonly db: TenantDb) { this.routing = new RoutingService(db); }
  private get r() { return this.db.repos; }
  private actor() { return getContext()?.userId; }

  private async country(): Promise<string> {
    const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec();
    return t?.country ?? 'IN';
  }

  private async activity(leadId: unknown, type: string, payload: Record<string, unknown> = {}, channel?: string) {
    await this.r.activities.create({ leadId, type, actorId: this.actor(), channel, payload, occurredAt: new Date() });
  }

  private async ensureSource(s?: { kind: string; name: string }) {
    if (!s) return undefined;
    const doc: any = await this.r.sources.findOneAndUpdate({ kind: s.kind, name: s.name }, { $setOnInsert: { kind: s.kind, name: s.name } }, { upsert: true, new: true });
    return doc._id;
  }

  /** The single path for every source: API, import, webhooks. */
  async intake(input: IntakeInput, opts: { dedupePolicy?: DedupePolicy } = {}): Promise<IntakeResult> {
    const { contacts, invalid } = normalizeContacts(input.contacts ?? [], await this.country());
    if (!contacts.length) return { outcome: 'rejected', reason: invalid.length ? 'no valid phone or email' : 'no contact provided', invalid };
    if (input.custom && Object.keys(input.custom).length) {
      const errs = customFieldErrors(await this.r.customFields.find(), input.custom);
      if (Object.keys(errs).length) return { outcome: 'rejected', reason: `invalid custom fields: ${Object.entries(errs).map(([k, m]) => `${k} ${m}`).join('; ')}` };
    }
    const sourceId = await this.ensureSource(input.source);
    for (let attempt = 0; ; attempt++) {
      try {
        return await withTransaction(this.db.conn, () => this.intakeTx(input, contacts, sourceId, opts.dedupePolicy ?? 'merge'));
      } catch (e) {
        if (isDup(e) && attempt < 2) continue; // lost a race on the unique contact index: retry as a merge
        throw e;
      }
    }
  }

  private async intakeTx(input: IntakeInput, contacts: NormContact[], sourceId: unknown, policy: DedupePolicy): Promise<IntakeResult> {
    if (input.externalRef && sourceId) {
      const ev: any = await this.r.leads.findOne({ sourceId, externalRef: input.externalRef });
      if (ev) return { outcome: 'duplicate_event', leadId: String(ev._id) };
    }
    const hits: any[] = await this.r.contactIndex.find({ $or: contacts.map((c) => ({ kind: c.kind, valueNorm: c.valueNorm })) });
    if (hits.length) return this.attachToExisting(String(hits[0].leadId), hits, contacts, input, sourceId, policy);

    const firstStatus: any = (await this.r.statuses.find({ kind: 'open' }, { sort: { position: 1 }, limit: 1 }))[0];
    const displayName = cleanName(input.name) || contacts.find((c) => c.kind === 'email')?.valueNorm || 'Unknown';
    const lead: any = await this.r.leads.create({
      displayName,
      nameTokens: nameTokens(displayName),
      statusId: firstStatus?._id, sourceId, externalRef: input.externalRef, metaLeadId: input.metaLeadId,
      campaign: input.campaign, adSet: input.adSet, ad: input.ad, formName: input.formName,
      ownerId: input.ownerId ? toObjectId(input.ownerId) : undefined, assignedAt: input.ownerId ? new Date() : undefined,
      city: input.city, language: input.language, budgetText: input.budgetText, score: input.score, tags: input.tags ?? [], custom: input.custom ?? {},
      contacts, phoneNorms: this.searchKeys(contacts), lastEnquiryAt: new Date(),
    });
    await this.r.contactIndex.createMany(contacts.map((c) => ({ kind: c.kind, valueNorm: c.valueNorm, leadId: lead._id })));
    await this.activity(lead._id, 'lead_created', { source: input.source, campaign: input.campaign, adSet: input.adSet, ad: input.ad, formName: input.formName, externalRef: input.externalRef, answers: input.raw && Object.keys(input.raw).length ? input.raw : undefined });
    await this.r.outbox.add('lead.created', String(lead._id), { sourceId: sourceId ? String(sourceId) : null });
    if (!input.ownerId) await this.routing.routeNew(lead._id); // no-op until the tenant configures routing
    return { outcome: 'created', leadId: String(lead._id) };
  }

  private async attachToExisting(leadId: string, hits: any[], contacts: NormContact[], input: IntakeInput, sourceId: unknown, policy: DedupePolicy): Promise<IntakeResult> {
    if (policy === 'skip') return { outcome: 'skipped', leadId };
    const lead: any = await this.r.leads.findById(leadId);
    const known = new Set(hits.map((h) => `${h.kind}:${h.valueNorm}`));
    const fresh = contacts.filter((c) => !known.has(`${c.kind}:${c.valueNorm}`)).map((c) => ({ ...c, isPrimary: false }));
    const set: Record<string, unknown> = { lastEnquiryAt: new Date() };
    if (policy === 'overwrite') {
      for (const k of ['city', 'language', 'budgetText', 'campaign', 'adSet', 'ad', 'formName'] as const) if ((input as any)[k]) set[k] = (input as any)[k];
      if (cleanName(input.name)) { set.displayName = cleanName(input.name); set.nameTokens = nameTokens(cleanName(input.name)); }
    }
    const update: Record<string, unknown> = { $set: set };
    if (fresh.length) {
      update.$push = { contacts: { $each: fresh }, phoneNorms: { $each: this.searchKeys(fresh) } };
      await this.r.contactIndex.createMany(fresh.map((c) => ({ kind: c.kind, valueNorm: c.valueNorm, leadId: lead._id })));
    }
    if (input.tags?.length) update.$addToSet = { tags: { $each: input.tags } };
    await this.r.leads.updateOne({ _id: lead._id }, update as any);
    await this.activity(lead._id, 're_enquired', { source: input.source, campaign: input.campaign, newContacts: fresh.length });
    await this.r.outbox.add('lead.re_enquired', String(lead._id), {});
    return { outcome: 'merged', leadId };
  }

  private searchKeys(contacts: Pick<NormContact, 'kind' | 'valueNorm'>[]) {
    return [...new Set(contacts.filter((c) => c.kind === 'phone').flatMap((c) => phoneSearchKeys(c.valueNorm)))];
  }

  async get(id: string) {
    const lead: any = await this.r.leads.findOne({ _id: id, deletedAt: null });
    if (!lead) throw notFound('Lead');
    return lead;
  }

  /** Typed custom-field validation against the tenant's definitions. */
  private async validateCustom(custom: Record<string, unknown>) {
    const errors = customFieldErrors(await this.r.customFields.find(), custom);
    if (Object.keys(errors).length) throw new DomainError('invalid_custom_fields', 'Invalid custom fields', errors);
  }

  async update(id: string, patch: { displayName?: string; city?: string; language?: string; budgetText?: string; tags?: string[]; custom?: Record<string, unknown>; nextActionAt?: Date | null }) {
    const lead: any = await this.get(id);
    const set: Record<string, unknown> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ['displayName', 'city', 'language', 'budgetText', 'tags', 'nextActionAt'] as const) {
      if ((patch as any)[k] !== undefined && JSON.stringify((patch as any)[k]) !== JSON.stringify(lead[k])) {
        set[k] = k === 'displayName' ? cleanName(patch.displayName) : (patch as any)[k];
        if (k === 'displayName') set.nameTokens = nameTokens(String(set[k]));
        changes[k] = { from: lead[k], to: set[k] };
      }
    }
    if (patch.custom) {
      await this.validateCustom(patch.custom);
      for (const [k, v] of Object.entries(patch.custom)) {
        if (JSON.stringify(lead.custom?.[k]) !== JSON.stringify(v)) { set[`custom.${k}`] = v; changes[`custom.${k}`] = { from: lead.custom?.[k], to: v }; }
      }
    }
    if (!Object.keys(set).length) return lead;
    await this.r.leads.updateOne({ _id: lead._id }, { $set: set });
    await this.activity(lead._id, 'field_changed', { changes });
    return this.get(id);
  }

  /** Status moves enforce lost reason and required fields (spec §11.2). */
  async changeStatus(id: string, statusId: string, o: { lostReasonId?: string } = {}) {
    const lead: any = await this.get(id);
    const status: any = await this.r.statuses.findById(statusId);
    if (!status) throw notFound('Status');
    const errors: Record<string, string> = {};
    if (status.kind === 'lost' && !o.lostReasonId) errors.lostReasonId = 'a lost reason is required';
    if (o.lostReasonId && !(await this.r.lostReasons.findById(o.lostReasonId))) errors.lostReasonId = 'unknown lost reason';
    const defs: any[] = await this.r.customFields.find({ requiredInStatusIds: status._id });
    const needed = [...(status.requiresFields ?? []), ...defs.map((d) => `custom.${d.key}`)];
    for (const f of needed) {
      const v = f.startsWith('custom.') ? lead.custom?.[f.slice(7)] : lead[f];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) errors[f] = `required to move to "${status.name}"`;
    }
    if (Object.keys(errors).length) throw new DomainError('status_requirements_not_met', 'Cannot change status', errors);
    await this.r.leads.updateOne({ _id: lead._id }, { $set: { statusId: status._id, lostReasonId: status.kind === 'lost' ? toObjectId(o.lostReasonId!) : null } });
    await this.activity(lead._id, 'status_changed', { from: lead.statusId, to: status._id, kind: status.kind, lostReasonId: o.lostReasonId });
    await this.r.outbox.add('lead.status_changed', id, { statusId, kind: status.kind });
    return this.get(id);
  }

  async addNote(id: string, text: string) {
    const lead: any = await this.get(id);
    await this.activity(lead._id, 'note', { text: text.slice(0, 5000) });
  }

  async timeline(id: string, o: { before?: string; limit?: number } = {}) {
    await this.get(id);
    const limit = Math.min(o.limit ?? 50, 200);
    const filter: Record<string, unknown> = { leadId: toObjectId(id) };
    if (o.before) filter._id = { $lt: toObjectId(o.before) };
    const items: any[] = await this.r.activities.find(filter, { sort: { _id: -1 }, limit: limit + 1 });
    return { items: items.slice(0, limit), nextBefore: items.length > limit ? String(items[limit - 1]._id) : null };
  }

  async softDelete(id: string) {
    const lead: any = await this.get(id);
    await this.r.leads.updateOne({ _id: lead._id }, { $set: { deletedAt: new Date() } });
    await this.activity(lead._id, 'field_changed', { changes: { deletedAt: { from: null, to: 'deleted' } } });
  }

  /** Merge loser into winner. Keeps all contacts/activities; snapshot allows undo for 30 days. */
  async merge(winnerId: string, loserId: string) {
    if (winnerId === loserId) throw new DomainError('invalid_merge', 'Cannot merge a lead into itself');
    return withTransaction(this.db.conn, async () => {
      const winner: any = await this.get(winnerId);
      const loser: any = await this.get(loserId);
      const loserIndex: any[] = await this.r.contactIndex.find({ leadId: loser._id });
      const moved: any[] = await this.r.activities.find({ leadId: loser._id }, { projection: { _id: 1 } });
      const winnerBefore = { contacts: winner.contacts, phoneNorms: winner.phoneNorms, tags: winner.tags, custom: winner.custom };
      const have = new Set(winner.contacts.map((c: any) => `${c.kind}:${c.valueNorm}`));
      const addContacts = loser.contacts.filter((c: any) => !have.has(`${c.kind}:${c.valueNorm}`)).map((c: any) => ({ ...c, isPrimary: false }));
      const mergedCustom = { ...(loser.custom ?? {}), ...(winner.custom ?? {}) }; // winner wins, gaps filled from loser
      await this.r.leads.updateOne({ _id: winner._id }, {
        $push: { contacts: { $each: addContacts }, phoneNorms: { $each: this.searchKeys(addContacts) } },
        $addToSet: { tags: { $each: loser.tags ?? [] } },
        $set: { custom: mergedCustom },
      });
      await this.r.contactIndex.updateMany({ leadId: loser._id }, { $set: { leadId: winner._id } });
      await this.r.activities.updateMany({ leadId: loser._id }, { $set: { leadId: winner._id } });
      await this.r.leads.updateOne({ _id: loser._id }, { $set: { deletedAt: new Date(), mergedInto: winner._id } });
      const merge: any = await this.r.merges.create({
        winnerId: winner._id, loserId: loser._id, mergedBy: this.actor(),
        snapshot: { loser, loserIndex: loserIndex.map((i) => ({ kind: i.kind, valueNorm: i.valueNorm })), movedActivityIds: moved.map((m) => m._id), winnerBefore },
      });
      await this.activity(winner._id, 'merge', { loserId, mergeId: String(merge._id), contactsAdded: addContacts.length });
      await this.r.outbox.add('lead.merged', String(winner._id), { loserId });
      return { mergeId: String(merge._id), winnerId };
    });
  }

  async undoMerge(mergeId: string) {
    return withTransaction(this.db.conn, async () => {
      const m: any = await this.r.merges.findById(mergeId);
      if (!m) throw notFound('Merge');
      if (m.undoneAt) throw new DomainError('already_undone', 'Merge already undone');
      if (Date.now() - new Date(m.createdAt).getTime() > MERGE_UNDO_DAYS * 86400_000) throw new DomainError('undo_expired', `Merges can be undone for ${MERGE_UNDO_DAYS} days`);
      const s = m.snapshot;
      await this.r.leads.updateOne({ _id: m.winnerId }, { $set: { contacts: s.winnerBefore.contacts, phoneNorms: s.winnerBefore.phoneNorms, tags: s.winnerBefore.tags, custom: s.winnerBefore.custom } });
      for (const i of s.loserIndex) await this.r.contactIndex.updateOne({ kind: i.kind, valueNorm: i.valueNorm }, { $set: { leadId: m.loserId } });
      await this.r.activities.updateMany({ _id: { $in: s.movedActivityIds } }, { $set: { leadId: m.loserId } });
      await this.r.leads.updateOne({ _id: m.loserId }, { $set: { deletedAt: null, mergedInto: null } });
      await this.r.merges.updateOne({ _id: m._id }, { $set: { undoneAt: new Date() } });
      await this.activity(m.winnerId, 'field_changed', { changes: { merge: { from: 'merged', to: 'undone' } }, mergeId });
      return { winnerId: String(m.winnerId), loserId: String(m.loserId) };
    });
  }

  /** (Re)assign a lead. `ownerId: null` sends it back to the unassigned/manager pool. */
  async assign(id: string, ownerId: string | null, teamId?: string | null) {
    const lead: any = await this.get(id);
    if (ownerId) {
      const m: any = await this.r.memberships.findOne({ userId: ownerId, status: 'active' });
      if (!m) throw new DomainError('invalid_owner', 'Owner is not an active member of this workspace');
      if (teamId === undefined) teamId = m.teamId ? String(m.teamId) : null;
    }
    await this.r.leads.updateOne({ _id: lead._id }, { $set: { ownerId: ownerId ? toObjectId(ownerId) : null, teamId: teamId ? toObjectId(teamId) : null, assignedAt: new Date(), claimedAt: null } });
    await this.activity(lead._id, lead.ownerId ? 'reassigned' : 'assigned', { from: lead.ownerId ?? null, to: ownerId });
    await this.r.outbox.add('lead.assigned', id, { ownerId });
  }

  // helpers for tests / callers
  newId = newObjectId;
}
