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
  { collection: 'importmappings', keys: { tenantId: 1, name: 1 }, options: { unique: true } },
  { collection: 'importrowerrors', keys: { tenantId: 1, jobId: 1, rowNo: 1 } },
  { collection: 'leadcontactindexes', keys: { tenantId: 1, leadId: 1 } },
  { collection: 'leadcontactindexes', keys: { tenantId: 1, kind: 1, valueNorm: 1 }, options: { unique: true } },
  { collection: 'integrationconnections', keys: { publicId: 1 }, options: { unique: true } },
  { collection: 'integrationconnections', keys: { tenantId: 1, provider: 1, status: 1 } },
  { collection: 'integrationinboxes', keys: { tenantId: 1, connectionId: 1, externalEventId: 1 }, options: { unique: true } },
  { collection: 'integrationinboxes', keys: { tenantId: 1, status: 1, receivedAt: 1 } },
  // raw payload retention: 90 days (configurable later by recreating the index)
  { collection: 'integrationinboxes', keys: { receivedAt: 1 }, options: { expireAfterSeconds: 90 * 86400 } },
  { collection: 'events', keys: { dispatchedAt: 1, claimedUntil: 1, _id: 1 } },
  { collection: 'events', keys: { tenantId: 1, type: 1, createdAt: -1 } },
  { collection: 'events', keys: { dispatchedAt: 1 }, options: { expireAfterSeconds: 7 * 86400, partialFilterExpression: { dispatchedAt: { $type: 'date' } } } },
  { collection: 'auditlogs', keys: { tenantId: 1, at: -1 } },
  { collection: 'auditlogs', keys: { tenantId: 1, entity: 1, entityId: 1, at: -1 } },
  { collection: 'counters', keys: { tenantId: 1, key: 1 }, options: { unique: true } },
];

export const COLLECTIONS = [...new Set(INDEXES.map((i) => i.collection))];

export async function ensureCollections(db: Db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const c of COLLECTIONS) if (!existing.has(c)) await db.createCollection(c);
}

export async function createIndexes(db: Db) {
  for (const i of INDEXES) await db.collection(i.collection).createIndex(i.keys, i.options ?? {});
}
