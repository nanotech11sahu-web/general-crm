import { Connection, Model, Schema, Types } from 'mongoose';
import { tenantPlugin } from '../tenant-plugin';

const ObjectId = Schema.Types.ObjectId;
const opts = { timestamps: true, minimize: false } as const;

function make(conn: Connection, name: string, def: Record<string, any>, o: { global?: boolean; timestamps?: boolean } = {}): Model<any> {
  const schema: Schema<any> = new Schema<any>(def as any, { ...opts, timestamps: o.timestamps ?? true, autoIndex: false, autoCreate: false } as any);
  schema.plugin(tenantPlugin as any, { global: o.global });
  return conn.model<any>(name, schema) as Model<any>;
}

/** Collections that are not tenant-owned. */
export const GLOBAL_COLLECTIONS = ['tenants', 'users'] as const;

export function buildModels(conn: Connection) {
  const Tenant = make(conn, 'Tenant', {
    name: { type: String, required: true },
    slug: { type: String, required: true },
    plan: { type: String, default: 'trial' },
    country: { type: String, default: 'IN' },
    timezone: { type: String, default: 'Asia/Kolkata' },
    locale: { type: String, default: 'en' },
    industryPreset: { type: String, default: 'generic' },
    settings: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  }, { global: true });

  const User = make(conn, 'User', {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String },
    name: { type: String, required: true },
    phone: String,
    totpSecretEnc: Buffer,
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  }, { global: true });

  const Membership = make(conn, 'Membership', {
    userId: { type: ObjectId, required: true },
    role: { type: String, enum: ['owner', 'admin', 'manager', 'agent'], required: true },
    teamId: ObjectId,
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    workingHours: Schema.Types.Mixed,
    languages: [String],
    skills: [String],
    maxOpenLeads: Number,
  });

  const Team = make(conn, 'Team', {
    name: { type: String, required: true },
    leadUserId: ObjectId,
  });

  const Invitation = make(conn, 'Invitation', {
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ['admin', 'manager', 'agent'], required: true },
    teamId: ObjectId,
    tokenHash: { type: String, required: true },
    invitedBy: { type: ObjectId, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
  });

  const RefreshToken = make(conn, 'RefreshToken', {
    userId: { type: ObjectId, required: true },
    family: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
    ua: String,
    ip: String,
  });

  const Lead = make(conn, 'Lead', {
    displayName: { type: String, required: true },
    statusId: ObjectId,
    lostReasonId: ObjectId,
    ownerId: ObjectId,
    teamId: ObjectId,
    sourceId: ObjectId,
    campaign: String, adSet: String, ad: String, formName: String,
    externalRef: String,
    metaLeadId: String,
    score: Number,
    language: String,
    city: String,
    budgetText: String,
    contacts: [{
      _id: false,
      kind: { type: String, enum: ['phone', 'email'], required: true },
      valueRaw: String,
      valueNorm: { type: String, required: true },
      isPrimary: Boolean,
      verified: Boolean,
      optedOutChannels: [String],
    }],
    nameTokens: [String], // lowercased word starts for anchored prefix search
    phoneNorms: [String], // denormalised for search: full E.164, last-10 digits and prefixes
    tags: [String],
    custom: { type: Schema.Types.Mixed, default: {} },
    consent: { type: Schema.Types.Mixed, default: {} },
    firstContactedAt: Date,
    lastContactedAt: Date,
    lastEnquiryAt: Date,
    nextActionAt: Date,
    assignedAt: Date,
    claimedAt: Date,
    mergedInto: ObjectId,
    deletedAt: Date,
  });

  const LeadStatus = make(conn, 'LeadStatus', {
    name: { type: String, required: true },
    kind: { type: String, enum: ['open', 'won', 'lost'], required: true },
    position: { type: Number, required: true },
    color: String,
    requiresFields: [String],
    autoActions: Schema.Types.Mixed,
  });
  const LostReason = make(conn, 'LostReason', { label: { type: String, required: true } });
  const LeadSource = make(conn, 'LeadSource', {
    kind: { type: String, required: true },
    name: { type: String, required: true },
    connectionId: ObjectId,
  });
  const CustomFieldDef = make(conn, 'CustomFieldDef', {
    key: { type: String, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ['text', 'number', 'select', 'date', 'boolean'], required: true },
    options: [String],
    requiredInStatusIds: [ObjectId],
    showInList: Boolean,
  });
  /** Append-only timeline. */
  const Activity = make(conn, 'Activity', {
    leadId: { type: ObjectId, required: true },
    type: { type: String, required: true },
    actorId: ObjectId,
    channel: String,
    payload: Schema.Types.Mixed,
    occurredAt: { type: Date, default: Date.now },
  }, { timestamps: false });
  const LeadMerge = make(conn, 'LeadMerge', {
    winnerId: { type: ObjectId, required: true },
    loserId: { type: ObjectId, required: true },
    mergedBy: ObjectId,
    snapshot: Schema.Types.Mixed,
    undoneAt: Date,
  });
  const SavedView = make(conn, 'SavedView', {
    ownerId: ObjectId,
    name: { type: String, required: true },
    filter: Schema.Types.Mixed,
    sort: Schema.Types.Mixed,
    shared: { type: Boolean, default: false },
  });
  const ImportJob = make(conn, 'ImportJob', {
    filename: String,
    fileKey: String,
    status: { type: String, enum: ['uploaded', 'mapped', 'dry_run_done', 'running', 'done', 'failed'], default: 'uploaded' },
    headers: [String],
    rowCount: { type: Number, default: 0 },
    heartbeatAt: Date,
    mapping: Schema.Types.Mixed,
    dedupePolicy: { type: String, enum: ['skip', 'merge', 'overwrite'], default: 'merge' },
    sourceId: ObjectId,
    stats: Schema.Types.Mixed,
    cursor: { type: Number, default: 0 },
    createdBy: ObjectId,
  });
  /** Parsed rows live in their own collection (16MB doc limit); object storage replaces this in a later phase. */
  const ImportRow = make(conn, 'ImportRow', {
    jobId: { type: ObjectId, required: true },
    rowNo: { type: Number, required: true },
    data: Schema.Types.Mixed,
    outcome: String, // set once the row has been processed: makes re-runs and crash-resume idempotent
  }, { timestamps: false });
  const ImportMapping = make(conn, 'ImportMapping', { name: { type: String, required: true }, mapping: Schema.Types.Mixed });
  const ImportRowError = make(conn, 'ImportRowError', {
    jobId: { type: ObjectId, required: true },
    rowNo: Number,
    raw: Schema.Types.Mixed,
    reason: String,
  });

  /** Dedupe source of truth: unique (tenantId, kind, valueNorm). */
  const LeadContactIndex = make(conn, 'LeadContactIndex', {
    kind: { type: String, enum: ['phone', 'email'], required: true },
    valueNorm: { type: String, required: true },
    leadId: { type: ObjectId, required: true },
  });

  const IntegrationConnection = make(conn, 'IntegrationConnection', {
    provider: { type: String, required: true },
    category: { type: String, required: true },
    name: { type: String, required: true },
    publicId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'verified', 'degraded', 'failing', 'revoked'], default: 'pending' },
    secretCiphertext: Buffer,
    secretWrappedDek: Buffer,
    secretKeyRef: String,
    secretHint: String,
    config: { type: Schema.Types.Mixed, default: {} },
    oauthExpiresAt: Date,
    lastVerifiedAt: Date,
    lastEventAt: Date,
    lastError: String,
    health: { type: Schema.Types.Mixed, default: {} },
    createdBy: ObjectId,
  });

  const IntegrationInbox = make(conn, 'IntegrationInbox', {
    connectionId: { type: ObjectId, required: true },
    provider: { type: String, required: true },
    eventType: String,
    externalEventId: { type: String, required: true },
    rawPayload: Schema.Types.Mixed,
    signatureValid: { type: Boolean, required: true },
    status: { type: String, enum: ['received', 'processing', 'done', 'failed', 'dead'], default: 'received' },
    attempts: { type: Number, default: 0 },
    error: String,
    receivedAt: { type: Date, default: Date.now },
    processedAt: Date,
  });

  /** Transactional outbox. */
  const Event = make(conn, 'Event', {
    type: { type: String, required: true },
    aggregateId: String,
    payload: { type: Schema.Types.Mixed, default: {} },
    dispatchedAt: Date,
    claimedUntil: Date,
  });

  const AuditLog = make(conn, 'AuditLog', {
    actorId: ObjectId,
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    ip: String,
    ua: String,
    meta: Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  }, { timestamps: false });

  const Counter = make(conn, 'Counter', {
    key: { type: String, required: true },
    seq: { type: Number, default: 0 },
  });

  return {
    Tenant, User, Membership, Team, Invitation, RefreshToken, Lead, LeadContactIndex,
    LeadStatus, LostReason, LeadSource, CustomFieldDef, Activity, LeadMerge, SavedView, ImportJob, ImportRow, ImportMapping, ImportRowError,
    IntegrationConnection, IntegrationInbox, Event, AuditLog, Counter,
  };
}
export type Models = ReturnType<typeof buildModels>;
export { Types };
