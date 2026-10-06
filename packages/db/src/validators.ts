import type { Db } from 'mongodb';

const oid = { bsonType: 'objectId' };
const str = { bsonType: 'string' };

/** $jsonSchema validators on critical collections (spec §5). */
export const VALIDATORS: Record<string, object> = {
  memberships: {
    bsonType: 'object', required: ['tenantId', 'userId', 'role'],
    properties: { tenantId: oid, userId: oid, role: { enum: ['owner', 'admin', 'manager', 'agent'] }, status: { enum: ['active', 'inactive'] } },
  },
  leads: {
    bsonType: 'object', required: ['tenantId', 'displayName'],
    properties: { tenantId: oid, displayName: str, contacts: { bsonType: 'array', maxItems: 10 } },
  },
  integrationconnections: {
    bsonType: 'object', required: ['tenantId', 'provider', 'publicId', 'status'],
    properties: { tenantId: oid, provider: str, publicId: str, status: { enum: ['pending', 'verified', 'degraded', 'failing', 'revoked'] } },
  },
  integrationinboxes: {
    bsonType: 'object', required: ['tenantId', 'connectionId', 'externalEventId', 'signatureValid'],
    properties: { tenantId: oid, connectionId: oid, externalEventId: str, signatureValid: { bsonType: 'bool' } },
  },
};

export async function applyValidators(db: Db) {
  for (const [name, $jsonSchema] of Object.entries(VALIDATORS)) {
    await db.command({ collMod: name, validator: { $jsonSchema }, validationLevel: 'strict', validationAction: 'error' });
  }
}
export async function removeValidators(db: Db) {
  for (const name of Object.keys(VALIDATORS)) {
    await db.command({ collMod: name, validator: {}, validationLevel: 'off' });
  }
}
