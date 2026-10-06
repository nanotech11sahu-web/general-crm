import type { Db } from 'mongodb';

type Idx = { collection: string; keys: Record<string, 1 | -1>; options?: Record<string, any> };

/** Every index leads with tenantId (spec §5). Global collections are the exception. */
export const INDEXES: Idx[] = [
  { collection: 'tenants', keys: { slug: 1 }, options: { unique: true } },
  { collection: 'users', keys: { email: 1 }, options: { unique: true } },
  { collection: 'memberships', keys: { tenantId: 1, userId: 1 }, options: { unique: true } },
  { collection: 'memberships', keys: { userId: 1 } },
  { collection: 'teams', keys: { tenantId: 1, name: 1 }, options: { unique: true } },
  { collection: 'invitations', keys: { tenantId: 1, email: 1 } },
  { collection: 'invitations', keys: { tokenHash: 1 }, options: { unique: true } },
  { collection: 'refreshtokens', keys: { tenantId: 1, userId: 1, family: 1 } },
  { collection: 'refreshtokens', keys: { tokenHash: 1 }, options: { unique: true } },
  { collection: 'refreshtokens', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  { collection: 'leads', keys: { tenantId: 1, ownerId: 1, statusId: 1, nextActionAt: 1 } },
  { collection: 'leads', keys: { tenantId: 1, sourceId: 1, createdAt: -1 } },
  { collection: 'leads', keys: { tenantId: 1, 'contacts.valueNorm': 1 } },
  { collection: 'leads', keys: { tenantId: 1, sourceId: 1, externalRef: 1 }, options: { unique: true, partialFilterExpression: { externalRef: { $type: 'string' } } } },
  { collection: 'leads', keys: { tenantId: 1, phoneNorms: 1 } },
  { collection: 'leads', keys: { tenantId: 1, deletedAt: 1, createdAt: -1 } },
  { collection: 'leads', keys: { tenantId: 1, nameTokens: 1 } },
  { collection: 'leads', keys: { tenantId: 1, statusId: 1, _id: -1 } },
  { collection: 'leadstatuses', keys: { tenantId: 1, position: 1 } },
  { collection: 'lostreasons', keys: { tenantId: 1, label: 1 }, options: { unique: true } },
  { collection: 'leadsources', keys: { tenantId: 1, kind: 1, name: 1 }, options: { unique: true } },
  { collection: 'customfielddefs', keys: { tenantId: 1, key: 1 }, options: { unique: true } },
  { collection: 'activities', keys: { tenantId: 1, leadId: 1, occurredAt: -1 } },
  { collection: 'leadmerges', keys: { tenantId: 1, winnerId: 1 } },
  { collection: 'savedviews', keys: { tenantId: 1, ownerId: 1 } },
  { collection: 'importjobs', keys: { tenantId: 1, createdAt: -1 } },
  { collection: 'importrows', keys: { tenantId: 1, jobId: 1, rowNo: 1 }, options: { unique: true } },
  { collection: 'importmappings', keys: { tenantId: 1, name: 1 }, options: { unique: true } },
  { collection: 'importrowerrors', keys: { tenantId: 1, jobId: 1, rowNo: 1 } },
  { collection: 'leadcontactindexes', keys: { tenantId: 1, leadId: 1 } },
  { collection: 'leadcontactindexes', keys: { tenantId: 1, kind: 1, valueNorm: 1 }, options: { unique: true } },
  { collection: 'integrationconnections', keys: { publicId: 1 }, options: { unique: true } },
  { collection: 'integrationconnections', keys: { tenantId: 1, provider: 1, status: 1 } },
  { collection: 'integrationinboxes', keys: { tenantId: 1, connectionId: 1, externalEventId: 1 }, options: { unique: true } },
  { collection: 'integrationinboxes', keys: { tenantId: 1, status: 1, receivedAt: 1 } },
  // raw payload retention: 90 days (configurable later by recreating the index)
  { collection: 'integrationinboxes', keys: { receivedAt: 1 }, options: { name: 'pending_by_age', partialFilterExpression: { status: { $in: ['received', 'processing', 'failed'] } } } }, // platform health: oldest unprocessed webhook
  { collection: 'integrationinboxes', keys: { receivedAt: 1 }, options: { expireAfterSeconds: 90 * 86400 } },
  { collection: 'integrationlogs', keys: { tenantId: 1, connectionId: 1, at: -1 } },
  { collection: 'integrationlogs', keys: { at: 1 }, options: { expireAfterSeconds: 30 * 86400 } },
  { collection: 'connectionhealthchecks', keys: { tenantId: 1, connectionId: 1, at: -1 } },
  { collection: 'connectionhealthchecks', keys: { at: 1 }, options: { expireAfterSeconds: 30 * 86400 } },
  { collection: 'notifications', keys: { tenantId: 1, audience: 1, userId: 1, createdAt: -1 } },
  { collection: 'notifications', keys: { tenantId: 1, dedupeKey: 1 }, options: { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } } },
  { collection: 'notifications', keys: { createdAt: 1 }, options: { expireAfterSeconds: 90 * 86400 } },
  { collection: 'conversations', keys: { tenantId: 1, leadId: 1, channel: 1, connectionId: 1 }, options: { unique: true } },
  { collection: 'conversations', keys: { tenantId: 1, unreadCount: 1, lastMessageAt: -1 } },
  { collection: 'messages', keys: { tenantId: 1, conversationId: 1, createdAt: 1 } },
  { collection: 'messages', keys: { tenantId: 1, leadId: 1, createdAt: -1 } },
  { collection: 'messages', keys: { tenantId: 1, idempotencyKey: 1 }, options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } } },
  { collection: 'messages', keys: { tenantId: 1, providerMessageId: 1 }, options: { unique: true, partialFilterExpression: { providerMessageId: { $type: 'string' } } } },
  { collection: 'messagetemplates', keys: { tenantId: 1, channel: 1, name: 1, language: 1 }, options: { unique: true } },
  { collection: 'pulsedailies', keys: { tenantId: 1, day: 1 }, options: { unique: true } },
  { collection: 'aisuggestions', keys: { tenantId: 1, leadId: 1, status: 1, createdAt: -1 } },
  { collection: 'aisuggestions', keys: { tenantId: 1, inputHash: 1, feature: 1 } },
  { collection: 'aiusages', keys: { tenantId: 1, day: 1, feature: 1 }, options: { unique: true } },
  { collection: 'suppressions', keys: { tenantId: 1, hash: 1 }, options: { unique: true } },
  { collection: 'cadences', keys: { tenantId: 1, name: 1 }, options: { unique: true } },
  { collection: 'cadenceenrollments', keys: { tenantId: 1, leadId: 1, state: 1 } },
  { collection: 'cadenceenrollments', keys: { tenantId: 1, leadId: 1, dedupeKey: 1 }, options: { unique: true } },
  // sweeper reads due enrollments across tenants (partial = only live ones)
  { collection: 'cadenceenrollments', keys: { nextRunAt: 1 }, options: { partialFilterExpression: { state: 'active' } } },
  { collection: 'integrationconnections', keys: { provider: 1, 'config.phoneNumberId': 1 } },
  { collection: 'integrationconnections', keys: { provider: 1, 'config.wabaId': 1 } },
  { collection: 'assignmentrules', keys: { tenantId: 1, priority: 1 } },
  { collection: 'routingdecisions', keys: { tenantId: 1, leadId: 1, createdAt: -1 } },
  { collection: 'slapolicies', keys: { tenantId: 1, active: 1 } },
  { collection: 'presences', keys: { tenantId: 1, userId: 1 }, options: { unique: true } },
  // SLA timers are durable lead state; the sweeper reads them across tenants (partial = only live timers)
  { collection: 'leads', keys: { 'sla.claimDueAt': 1 }, options: { partialFilterExpression: { 'sla.state': 'awaiting_claim' } } },
  { collection: 'leads', keys: { 'sla.firstContactDueAt': 1 }, options: { partialFilterExpression: { 'sla.state': { $in: ['awaiting_claim', 'claimed'] } } } },
  { collection: 'outcomes', keys: { tenantId: 1, label: 1 }, options: { unique: true } },
  { collection: 'tasks', keys: { tenantId: 1, assigneeId: 1, status: 1, dueAt: 1 } },
  { collection: 'tasks', keys: { tenantId: 1, leadId: 1, status: 1 } },
  // sweep: open tasks only (partial), cross-tenant by due date
  { collection: 'tasks', keys: { dueAt: 1 }, options: { partialFilterExpression: { status: 'open' } } },
  { collection: 'callsessions', keys: { tenantId: 1, agentId: 1, outcomeId: 1, startedAt: -1 } },
  { collection: 'callsessions', keys: { tenantId: 1, leadId: 1, startedAt: -1 } },
  { collection: 'callsessions', keys: { tenantId: 1, connectionId: 1, providerCallId: 1 }, options: { unique: true, partialFilterExpression: { providerCallId: { $type: 'string' } } } },
  { collection: 'oauthstates', keys: { tenantId: 1, nonce: 1 }, options: { unique: true } },
  { collection: 'oauthstates', keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
  // app-level webhooks (Meta) route by page id: a named system lookup, so it cannot lead with tenantId
  { collection: 'integrationconnections', keys: { provider: 1, 'config.pageIds': 1 } },
  { collection: 'events', keys: { dispatchedAt: 1, claimedUntil: 1, _id: 1 } },
  { collection: 'events', keys: { tenantId: 1, type: 1, createdAt: -1 } },
  { collection: 'events', keys: { dispatchedAt: 1 }, options: { expireAfterSeconds: 7 * 86400, partialFilterExpression: { dispatchedAt: { $type: 'date' } } } },
  { collection: 'auditlogs', keys: { tenantId: 1, at: -1 } },
  { collection: 'auditlogs', keys: { tenantId: 1, entity: 1, entityId: 1, at: -1 } },
  { collection: 'counters', keys: { tenantId: 1, key: 1 }, options: { unique: true } },
];

/**
 * Added after the first release candidate by the audit in apps/api/test/perf.test.ts. Always add new indexes here (and a
 * migration), never to INDEXES, so databases that already ran the init migration receive them.
 */
export const INDEXES_V2: Idx[] = [
  // newest-first lists sort by _id: without these the planner may walk the whole _id index across all tenants
  { collection: 'leads', keys: { tenantId: 1, deletedAt: 1, _id: -1 }, options: { name: 'v2_leads_tenant_deleted_id' } },
  { collection: 'leads', keys: { tenantId: 1, ownerId: 1, deletedAt: 1, _id: -1 }, options: { name: 'v2_leads_owner_deleted_id' } },
  // inbound replies queue: ordered by last inbound, only conversations with something unread
  { collection: 'conversations', keys: { tenantId: 1, lastInboundAt: 1 }, options: { name: 'v2_conversations_unread', partialFilterExpression: { unreadCount: { $gt: 0 } } } },
  // Pulse / health windows that are not scoped by assignee or lead
  { collection: 'tasks', keys: { tenantId: 1, dueAt: 1 }, options: { name: 'v2_tasks_tenant_due' } },
  { collection: 'tasks', keys: { tenantId: 1, status: 1, dueAt: 1 }, options: { name: 'v2_tasks_tenant_status_due' } },
  { collection: 'messages', keys: { tenantId: 1, direction: 1, createdAt: -1 }, options: { name: 'v2_messages_direction_created' } },
  { collection: 'callsessions', keys: { tenantId: 1, startedAt: -1 }, options: { name: 'v2_calls_tenant_started' } },
];

export const COLLECTIONS = [...new Set(INDEXES.map((i) => i.collection))];

export async function ensureCollections(db: Db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const c of COLLECTIONS) if (!existing.has(c)) await db.createCollection(c);
}

export async function createIndexes(db: Db, list: Idx[] = INDEXES) {
  for (const i of list) await db.collection(i.collection).createIndex(i.keys, i.options ?? {});
}
