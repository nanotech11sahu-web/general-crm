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
    onLeaveUntil: Date,
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
    lastOwnerId: ObjectId,
    sla: Schema.Types.Mixed, // { policyId, state, claimDueAt, firstContactDueAt, reassignCount, triedUserIds[] }
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

  const IntegrationLog = make(conn, 'IntegrationLog', {
    connectionId: { type: ObjectId, required: true },
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message: { type: String, required: true },
    meta: Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  }, { timestamps: false });
  const ConnectionHealthCheck = make(conn, 'ConnectionHealthCheck', {
    connectionId: { type: ObjectId, required: true },
    check: { type: String, required: true },
    ok: { type: Boolean, required: true },
    detail: String,
    at: { type: Date, default: Date.now },
  }, { timestamps: false });
  const Notification = make(conn, 'Notification', {
    userId: ObjectId, // null = every admin/owner of the tenant
    audience: { type: String, enum: ['user', 'admins', 'managers'], default: 'user' },
    kind: { type: String, required: true },
    payload: Schema.Types.Mixed,
    dedupeKey: String,
    readAt: Date,
  });

  const Conversation = make(conn, 'Conversation', {
    leadId: { type: ObjectId, required: true },
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    connectionId: { type: ObjectId, required: true },
    externalThreadId: String, // the lead's number on that channel
    windowExpiresAt: Date,    // WhatsApp 24h customer-service window
    lastInboundAt: Date,
    lastMessageAt: Date,
    lastMessagePreview: String,
    unreadCount: { type: Number, default: 0 },
  });
  const Message = make(conn, 'Message', {
    conversationId: { type: ObjectId, required: true },
    leadId: { type: ObjectId, required: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    channel: String,
    body: String,
    templateId: ObjectId,
    source: { type: String, enum: ['agent', 'cadence', 'first_touch', 'inbound', 'system'], default: 'agent' },
    media: Schema.Types.Mixed,
    providerMessageId: String,
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'received'], default: 'queued' },
    error: String,
    sentBy: ObjectId,
    idempotencyKey: String,
    sendingUntil: Date, // short lease while a provider call is in flight (concurrent duplicate guard)
  });
  const MessageTemplate = make(conn, 'MessageTemplate', {
    channel: { type: String, enum: ['whatsapp', 'sms', 'email'], required: true },
    name: { type: String, required: true },
    body: { type: String, required: true },
    variables: [String],
    language: { type: String, default: 'en' },
    category: { type: String, default: 'utility' },
    connectionId: ObjectId,
    providerTemplateId: String,
    dltTemplateId: String,
    dltHeader: String,
    status: { type: String, enum: ['draft', 'pending', 'approved', 'rejected'], default: 'draft' },
    rejectionReason: String,
  });
  const Cadence = make(conn, 'Cadence', {
    name: { type: String, required: true },
    active: { type: Boolean, default: true },
    stopOn: { type: Schema.Types.Mixed, default: { inboundReply: true, connectedCall: true, statusChange: true, optOut: true } },
    steps: [{ _id: false, offsetMinutes: Number, action: { type: String, enum: ['task', 'message'] }, channel: String, templateId: ObjectId, taskType: String, note: String }],
    enrollOn: { type: Schema.Types.Mixed, default: {} }, // { statusIds?: [], outcomeIds?: [], sourceKinds?: [] }
  });
  const CadenceEnrollment = make(conn, 'CadenceEnrollment', {
    leadId: { type: ObjectId, required: true },
    cadenceId: ObjectId,
    dedupeKey: { type: String, required: true },
    kind: { type: String, enum: ['cadence', 'first_touch'], default: 'cadence' },
    stopOn: Schema.Types.Mixed,
    steps: [{ _id: false, runAt: Date, action: String, channel: String, templateId: ObjectId, taskType: String, note: String, done: Boolean, result: String }],
    stepIndex: { type: Number, default: 0 },
    state: { type: String, enum: ['active', 'completed', 'stopped'], default: 'active' },
    nextRunAt: Date,
    stoppedReason: String,
  });

  /** First matching rule wins (priority asc). */
  const AssignmentRule = make(conn, 'AssignmentRule', {
    name: { type: String, required: true },
    priority: { type: Number, required: true },
    conditions: { type: Schema.Types.Mixed, default: {} },
    action: { type: Schema.Types.Mixed, required: true },
    active: { type: Boolean, default: true },
  });
  const RoutingDecision = make(conn, 'RoutingDecision', {
    leadId: { type: ObjectId, required: true },
    ruleId: ObjectId,
    chosenUserId: ObjectId,
    strategy: String,
    reason: String, // 'new' | 'sla_claim' | 'sla_first_contact' | 'manual'
    explanation: { type: String, required: true },
  });
  const SlaPolicy = make(conn, 'SlaPolicy', {
    name: { type: String, required: true },
    firstContactSeconds: { type: Number, required: true },
    claimSeconds: { type: Number, required: true },
    maxReassignments: { type: Number, default: 2 },
    appliesTo: { type: Schema.Types.Mixed, default: {} }, // { sourceKinds?: string[] }
    active: { type: Boolean, default: true },
  });
  const Presence = make(conn, 'Presence', {
    userId: { type: ObjectId, required: true },
    state: { type: String, enum: ['online', 'on_call', 'away', 'offline'], default: 'offline' },
    updatedAt: { type: Date, default: Date.now },
  }, { timestamps: false });

  /** Call dispositions per tenant, seeded by the industry preset. */
  const Outcome = make(conn, 'Outcome', {
    label: { type: String, required: true },
    kind: { type: String, enum: ['connected', 'not_connected', 'dead'], required: true },
    requiresNextAction: { type: Boolean, default: false },
    defaultNextOffsetMin: Number, // suggested follow-up delay; 0/undefined = agent must pick
    suggestStatusId: ObjectId,
    suggestLostReasonLabel: String,
    active: { type: Boolean, default: true },
  });
  /** A follow-up always has a concrete dueAt and a context note: no vague "next week". */
  const Task = make(conn, 'Task', {
    leadId: { type: ObjectId, required: true },
    assigneeId: { type: ObjectId, required: true },
    type: { type: String, enum: ['call', 'whatsapp', 'sms', 'visit', 'other'], default: 'call' },
    dueAt: { type: Date, required: true },
    contextNote: { type: String, required: true },
    graceMinutes: { type: Number, default: 15 },
    createdFromOutcomeId: ObjectId,
    status: { type: String, enum: ['open', 'done', 'missed', 'cancelled'], default: 'open' },
    completedAt: Date,
    missedAt: Date,
    escalatedAt: Date,
  });
  const CallSession = make(conn, 'CallSession', {
    leadId: { type: ObjectId, required: true },
    agentId: { type: ObjectId, required: true },
    connectionId: ObjectId,
    mode: { type: String, enum: ['cloud', 'tap', 'companion', 'softphone'], default: 'tap' },
    direction: { type: String, enum: ['out', 'in'], default: 'out' },
    providerCallId: String,
    state: { type: String, enum: ['dialed', 'ringing', 'answered', 'ended', 'missed'], default: 'dialed' },
    startedAt: { type: Date, default: Date.now },
    answeredAt: Date,
    endedAt: Date,
    durationS: Number,
    durationSource: { type: String, enum: ['system', 'self_reported'], default: 'self_reported' },
    outcomeId: ObjectId,
    outcomeLoggedAt: Date,
    outcomeSkips: { type: Number, default: 0 },
    providerOutcome: String,
    recordingObjectKey: String,
  });

  /** Single-use OAuth `state` (+ PKCE verifier) bound to tenant/user; consumed on callback, TTL 10 min. */
  const OAuthState = make(conn, 'OAuthState', {
    nonce: { type: String, required: true },
    userId: ObjectId,
    provider: { type: String, required: true },
    codeVerifier: String,
    meta: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  });

  const Counter = make(conn, 'Counter', {
    key: { type: String, required: true },
    seq: { type: Number, default: 0 },
  });

  return {
    Tenant, User, Membership, Team, Invitation, RefreshToken, Lead, LeadContactIndex,
    LeadStatus, LostReason, LeadSource, CustomFieldDef, Activity, LeadMerge, SavedView, ImportJob, ImportRow, ImportMapping, ImportRowError,
    IntegrationConnection, IntegrationInbox, IntegrationLog, ConnectionHealthCheck, Notification, OAuthState, Conversation, Message, MessageTemplate, Cadence, CadenceEnrollment, AssignmentRule, RoutingDecision, SlaPolicy, Presence, Outcome, Task, CallSession, Event, AuditLog, Counter,
  };
}
export type Models = ReturnType<typeof buildModels>;
export { Types };
