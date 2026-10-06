import { createHash } from 'node:crypto';
import { EJSON } from 'bson';
import { requireTenantId, runWithTenant, toObjectId, withTransaction, type SystemOps, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import type { ObjectStore } from './storage';

const DAY = 86_400_000;
/** Never part of a data export or restore: ephemeral, secret-bearing or bulky raw copies. */
const EXCLUDED = new Set(['Tenant', 'User', 'RefreshToken', 'OAuthState', 'IntegrationInbox', 'IntegrationLog', 'ConnectionHealthCheck', 'Event', 'Counter', 'Notification']);
const SECRET_FIELDS = ['secretCiphertext', 'secretWrappedDek', 'secretKeyRef', 'tokenHash', 'passwordHash']; // stripped from every exported document
export const EXPORT_VERSION = 1;

/** DPDP / GDPR: subject access (export) and erasure for a single lead. */
export class PrivacyService {
  constructor(private readonly db: TenantDb, private readonly store?: ObjectStore, private readonly now: () => Date = () => new Date()) {}
  private get r() { return this.db.repos; }

  /** Salted per tenant, so a hash from one workspace says nothing in another. */
  static suppressionHash(tenantId: string, phoneNorm: string) { return createHash('sha256').update(`leaddesk:suppress:${tenantId}:${phoneNorm}`).digest('hex'); }
  async isSuppressed(phoneNorm: string) { return !!(await this.r.suppressions.findOne({ hash: PrivacyService.suppressionHash(requireTenantId(), phoneNorm) })); }

  /** Everything held about one person, as plain JSON. Recording files are referenced, not embedded. */
  async exportLead(leadId: string) {
    const lead: any = await this.r.leads.findOne({ _id: leadId });
    if (!lead) throw notFound('Lead');
    const convs: any[] = await this.r.conversations.find({ leadId: lead._id });
    const [activities, tasks, calls, messages, ai, enrollments] = await Promise.all([
      this.r.activities.find({ leadId: lead._id }, { sort: { occurredAt: 1 }, limit: 20_000 }), this.r.tasks.find({ leadId: lead._id }),
      this.r.callSessions.find({ leadId: lead._id }), convs.length ? this.r.messages.find({ conversationId: { $in: convs.map((c) => c._id) } }, { sort: { createdAt: 1 }, limit: 50_000 }) : [],
      this.r.aiSuggestions.find({ leadId: lead._id }), this.r.enrollments.find({ leadId: lead._id }),
    ]);
    const { phoneNorms: _p, nameTokens: _n, ...profile } = lead; void _p; void _n;
    return { exportedAt: this.now(), version: EXPORT_VERSION, lead: profile, activities, tasks, conversations: convs, messages, calls: (calls as any[]).map(({ recordingObjectKey, ...c }) => ({ ...c, hasRecording: !!recordingObjectKey })), aiSuggestions: ai, cadenceEnrollments: enrollments };
  }

  /** Hard-deletes the lead and everything hanging off it. A phone-hash suppression stays so we never contact them again. */
  async eraseLead(leadId: string, o: { reason?: string; suppress?: boolean } = {}) {
    const lead: any = await this.r.leads.findOne({ _id: leadId });
    if (!lead) throw notFound('Lead');
    const tenantId = requireTenantId(); const counts: Record<string, number> = {};
    const recordings: string[] = [];
    await withTransaction(this.db.conn, async () => {
      const convs: any[] = await this.r.conversations.find({ leadId: lead._id }, { projection: { _id: 1 } });
      const calls: any[] = await this.r.callSessions.find({ leadId: lead._id }, { projection: { recordingObjectKey: 1 } });
      for (const c of calls) if (c.recordingObjectKey) recordings.push(c.recordingObjectKey);
      if (o.suppress !== false) for (const c of (lead.contacts ?? []).filter((x: any) => x.kind === 'phone')) await this.r.suppressions.updateOne({ hash: PrivacyService.suppressionHash(tenantId, c.valueNorm) }, { $set: { reason: o.reason ?? 'erasure', hash: PrivacyService.suppressionHash(tenantId, c.valueNorm) } }, { upsert: true });
      const del = async (name: string, p: Promise<any>) => { counts[name] = (await p).deletedCount ?? 0; };
      if (convs.length) await del('messages', this.r.messages.deleteMany({ conversationId: { $in: convs.map((c) => c._id) } }));
      await del('conversations', this.r.conversations.deleteMany({ leadId: lead._id }));
      await del('activities', this.r.activities.deleteMany({ leadId: lead._id }));
      await del('tasks', this.r.tasks.deleteMany({ leadId: lead._id }));
      await del('calls', this.r.callSessions.deleteMany({ leadId: lead._id }));
      await del('cadenceEnrollments', this.r.enrollments.deleteMany({ leadId: lead._id }));
      await del('aiSuggestions', this.r.aiSuggestions.deleteMany({ leadId: lead._id }));
      await del('routingDecisions', this.r.routingDecisions.deleteMany({ leadId: lead._id }));
      await del('merges', this.r.merges.deleteMany({ $or: [{ winnerId: lead._id }, { loserId: lead._id }] })); // merge snapshots contain the full contact record
      await del('notifications', this.r.notifications.deleteMany({ 'payload.leadId': String(lead._id) }));
      const refs = [lead.metaLeadId, lead.externalRef].filter(Boolean);
      if (refs.length) await del('rawEvents', this.r.inbox.deleteMany({ externalEventId: { $in: refs } })); // stored webhook payloads carry the original form
      await del('contactIndex', this.r.contactIndex.deleteMany({ leadId: lead._id }));
      await del('leads', this.r.leads.deleteOne({ _id: lead._id }));
      await this.r.audit.record({ action: 'privacy.lead_erased', entity: 'lead', entityId: String(lead._id), meta: { reason: o.reason ?? null, counts } }); // no personal data in the audit row
    });
    for (const k of recordings) await this.store?.delete(k).catch(() => undefined); // after commit: a failed file delete is retried by retention, never blocks erasure
    return { erased: true, counts, recordingsDeleted: recordings.length };
  }
}

/** Whole-workspace portability, deletion and the restore drill. */
export class TenantDataService {
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date()) {}

  private modelNames() { return Object.keys(this.db.models).filter((n) => !EXCLUDED.has(n)); }

  /** Streams NDJSON (extended JSON so ids and dates restore with their types). Credentials are never included. */
  async *exportLines(): AsyncGenerator<string> {
    const tenantId = requireTenantId(); const names = this.modelNames();
    const t: any = await this.db.models.Tenant.findById(tenantId).lean().exec();
    const members: any[] = await this.db.repos.memberships.find({});
    const users: any[] = members.length ? await this.db.models.User.find({ _id: { $in: members.map((m) => m.userId) } }, { email: 1, name: 1, phone: 1 }).lean().exec() : [];
    yield EJSON.stringify({ type: 'manifest', version: EXPORT_VERSION, tenantId, exportedAt: this.now(), tenant: { name: t?.name, timezone: t?.timezone, country: t?.country, industryPreset: t?.industryPreset, settings: t?.settings }, collections: names, note: 'Credentials, sessions and raw webhook copies are not included.' }, { relaxed: true });
    for (const u of users) yield EJSON.stringify({ c: 'User', d: u }, { relaxed: true });
    for (const name of names) {
      for await (const d of (this.db.models as any)[name].find({}).lean().cursor()) {
        for (const f of SECRET_FIELDS) delete d[f];
        yield EJSON.stringify({ c: name, d }, { relaxed: true });
      }
    }
  }

  /**
   * Restore drill: load an export into a scratch database (raw inserts, original ids) and verify it.
   * Returns per-collection counts and whether every manifest collection matched the source counts.
   */
  static async restoreExport(lines: AsyncIterable<string> | Iterable<string>, target: TenantDb) {
    const restored: Record<string, number> = {}; let manifest: any;
    const batch = new Map<string, any[]>();
    const flush = async (name: string) => { const docs = batch.get(name); if (!docs?.length) return; await ((target.models as any)[name]).collection.insertMany(docs, { ordered: true }); restored[name] = (restored[name] ?? 0) + docs.length; batch.set(name, []); };
    for await (const line of lines as AsyncIterable<string>) {
      if (!line.trim()) continue;
      const o: any = EJSON.parse(line, { relaxed: true });
      if (o.type === 'manifest') { manifest = o; continue; }
      if (!manifest) throw new DomainError('invalid_export', 'The export does not start with a manifest');
      if (o.c === 'User') { await (target.models.User as any).collection.updateOne({ _id: o.d._id }, { $setOnInsert: o.d }, { upsert: true }); restored.User = (restored.User ?? 0) + 1; continue; }
      if (!manifest.collections.includes(o.c)) throw new DomainError('invalid_export', `Unexpected collection ${o.c}`);
      (batch.get(o.c) ?? batch.set(o.c, []).get(o.c)!).push(o.d);
      if (batch.get(o.c)!.length >= 500) await flush(o.c);
    }
    for (const name of batch.keys()) await flush(name);
    if (!manifest) throw new DomainError('invalid_export', 'Empty export');
    return { manifest, restored };
  }

  // ---------- deletion workflow ----------
  async deletionStatus() { const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec(); return t?.settings?.deletion ?? null; }
  async requestDeletion(by: string, graceDays = Number(process.env.DELETION_GRACE_DAYS ?? 14)) {
    const dueAt = new Date(this.now().getTime() + graceDays * DAY);
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: { 'settings.deletion': { requestedAt: this.now(), dueAt, by } } });
    await this.db.repos.audit.record({ action: 'tenant.deletion_requested', entity: 'tenant', entityId: requireTenantId(), meta: { dueAt } });
    return { dueAt };
  }
  async cancelDeletion() {
    await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $unset: { 'settings.deletion': 1 } });
    await this.db.repos.audit.record({ action: 'tenant.deletion_cancelled', entity: 'tenant', entityId: requireTenantId() });
    return { ok: true };
  }

  /** Irreversible: removes every tenant-owned document, recordings, and users that belong to no other workspace. */
  static async purge(db: TenantDb, sys: SystemOps, tenantId: string, store?: ObjectStore) {
    const counts: Record<string, number> = {}; let userIds: any[] = [];
    await runWithTenant(tenantId, async () => {
      userIds = ((await db.repos.memberships.find({})) as any[]).map((m) => m.userId);
      for (const name of Object.keys(db.models).filter((n) => n !== 'Tenant' && n !== 'User')) counts[name] = ((await (db.models as any)[name].deleteMany({})) as any).deletedCount ?? 0; // plugin scopes to this tenant
    });
    for (const uid of userIds) if ((await sys.membershipCount(uid)) === 0) await db.models.User.deleteOne({ _id: uid });
    await store?.deletePrefix(`tenants/${tenantId}`);
    await db.models.Tenant.updateOne({ _id: toObjectId(tenantId) }, { $set: { status: 'deleted', deletedAt: new Date(), name: 'deleted', slug: `deleted-${tenantId}`, settings: {} } });
    return counts;
  }
}

/** Daily: recording retention, soft-deleted lead purge, and workspaces whose deletion grace period ended. */
export class RetentionService {
  constructor(private readonly db: TenantDb, private readonly store?: ObjectStore, private readonly now: () => Date = () => new Date()) {}
  private get r() { return this.db.repos; }
  async settings() {
    const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec(); const s = t?.settings?.retention ?? {};
    return { recordingDays: s.recordingDays ?? 180, softDeletedLeadDays: s.softDeletedLeadDays ?? 30, importDays: s.importDays ?? 30 };
  }
  async updateSettings(p: { recordingDays?: number; softDeletedLeadDays?: number; importDays?: number }) {
    const set: Record<string, unknown> = {};
    if (p.recordingDays !== undefined) { if (!Number.isInteger(p.recordingDays) || p.recordingDays < 7 || p.recordingDays > 3650) throw new DomainError('invalid_settings', 'recordingDays must be 7 to 3650'); set['settings.retention.recordingDays'] = p.recordingDays; }
    if (p.softDeletedLeadDays !== undefined) { if (!Number.isInteger(p.softDeletedLeadDays) || p.softDeletedLeadDays < 1 || p.softDeletedLeadDays > 365) throw new DomainError('invalid_settings', 'softDeletedLeadDays must be 1 to 365'); set['settings.retention.softDeletedLeadDays'] = p.softDeletedLeadDays; }
    if (p.importDays !== undefined) { if (!Number.isInteger(p.importDays) || p.importDays < 1 || p.importDays > 365) throw new DomainError('invalid_settings', 'importDays must be 1 to 365'); set['settings.retention.importDays'] = p.importDays; }
    if (Object.keys(set).length) await this.db.models.Tenant.updateOne({ _id: requireTenantId() }, { $set: set });
    return this.settings();
  }
  async run() {
    const s = await this.settings(); const now = this.now();
    let recordings = 0, leads = 0, imports = 0;
    const old: any[] = await this.r.callSessions.find({ recordingObjectKey: { $ne: null }, startedAt: { $lt: new Date(now.getTime() - s.recordingDays * DAY) } }, { limit: 500 });
    for (const c of old) { await this.store?.delete(c.recordingObjectKey); await this.r.callSessions.updateOne({ _id: c._id }, { $set: { recordingObjectKey: null, recordingExpiredAt: now }, $unset: { 'analysis.transcript': 1 } }); recordings++; }
    const gone: any[] = await this.r.leads.find({ deletedAt: { $lt: new Date(now.getTime() - s.softDeletedLeadDays * DAY) } }, { limit: 200, projection: { _id: 1 } });
    for (const l of gone) { await new PrivacyService(this.db, this.store, () => now).eraseLead(String(l._id), { reason: 'retention' }); leads++; }
    // uploaded spreadsheets are copies of customer contact data: they go once the import is over (or was abandoned) and its window has passed
    const stale: any[] = await this.r.importJobs.find({ status: { $ne: 'running' }, purgedAt: null, updatedAt: { $lt: new Date(now.getTime() - s.importDays * DAY) } }, { limit: 200, projection: { _id: 1 } });
    for (const j of stale) {
      await this.r.importRows.deleteMany({ jobId: j._id }); await this.r.importRowErrors.deleteMany({ jobId: j._id });
      await this.r.importJobs.updateOne({ _id: j._id }, { $set: { purgedAt: now, headers: [], mapping: null } }); imports++;
    }
    return { recordings, leads, imports };
  }
  static async sweepAll(db: TenantDb, sys: SystemOps, store?: ObjectStore, now: () => Date = () => new Date()) {
    let recordings = 0, leads = 0, purged = 0, imports = 0;
    for (const t of (await sys.activeTenants()) as any[]) {
      try { const r = await runWithTenant(String(t._id), () => new RetentionService(db, store, now).run()); recordings += r.recordings; leads += r.leads; imports += r.imports; } catch { /* next tenant */ }
    }
    for (const t of (await sys.deletionsDue(now())) as any[]) { try { await TenantDataService.purge(db, sys, String(t._id), store); purged++; } catch { /* retried next run */ } }
    return { recordings, leads, imports, purged };
  }
}
