import { Types } from 'mongoose';
import { getContext, requireTenantId, runAsSystem, runWithTenant } from './context';
import { Models } from './models';
import { TenantScopedRepository } from './repository';

export class OutboxRepository extends TenantScopedRepository {
  /** Call inside withTransaction so the event commits atomically with the change. */
  add(type: string, aggregateId: string, payload: Record<string, any> = {}) {
    return this.create({ type, aggregateId, payload });
  }
}

export class AuditRepository extends TenantScopedRepository {
  record(e: { action: string; entity?: string; entityId?: string; meta?: any; ip?: string; ua?: string }) {
    return this.create({ ...e, actorId: getContext()?.userId, at: new Date() });
  }
}

export class LeadRepository extends TenantScopedRepository {
  constructor(model: any, private readonly contactIndex: TenantScopedRepository) { super(model); }

  /**
   * Creates a lead and its dedupe index entries. Must run in a transaction
   * (use withTransaction) so a duplicate rolls everything back.
   */
  async createWithContacts(doc: { displayName: string; contacts: { kind: 'phone' | 'email'; valueNorm: string; valueRaw?: string }[] } & Record<string, any>) {
    const lead = await this.create(doc);
    await this.contactIndex.createMany(doc.contacts.map((c) => ({ kind: c.kind, valueNorm: c.valueNorm, leadId: lead._id })));
    return lead;
  }
  async findDuplicate(kind: 'phone' | 'email', valueNorm: string) {
    return this.contactIndex.findOne({ kind, valueNorm });
  }
}

export class ConnectionRepository extends TenantScopedRepository {
  /** Strips every secret field. API layers must only ever see this shape. */
  async listSafe() {
    const rows = await this.find({}, { projection: { secretCiphertext: 0, secretWrappedDek: 0 } });
    return rows;
  }
}

export function createRepositories(m: Models) {
  const contactIndex = new TenantScopedRepository(m.LeadContactIndex);
  return {
    memberships: new TenantScopedRepository(m.Membership),
    teams: new TenantScopedRepository(m.Team),
    invitations: new TenantScopedRepository(m.Invitation),
    refreshTokens: new TenantScopedRepository(m.RefreshToken),
    leads: new LeadRepository(m.Lead, contactIndex),
    connections: new ConnectionRepository(m.IntegrationConnection),
    inbox: new TenantScopedRepository(m.IntegrationInbox),
    outbox: new OutboxRepository(m.Event),
    audit: new AuditRepository(m.AuditLog),
    counters: new TenantScopedRepository(m.Counter),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;

/**
 * Named, limited cross-tenant operations. Feature code cannot run arbitrary
 * system queries: it can only call these.
 */
export function createSystemOps(m: Models) {
  return {
    /** webhook-ingress: opaque public id -> tenant + connection. */
    resolveConnection: (publicId: string) =>
      runAsSystem('webhook.resolveConnection', () => m.IntegrationConnection.findOne({ publicId }).lean().exec()),

    findUserByEmail: (email: string) =>
      runAsSystem('auth.findUserByEmail', () => m.User.findOne({ email: email.toLowerCase() }).exec()),

    /** Login: all memberships of a user across tenants. */
    listMemberships: (userId: Types.ObjectId | string) =>
      runAsSystem('auth.listMemberships', () => m.Membership.find({ userId, status: 'active' }).lean().exec()),

    /** Outbox dispatcher: lease a batch of undispatched events across tenants. */
    claimEvents: (limit = 100, leaseMs = 30_000) =>
      runAsSystem('outbox.dispatch', async () => {
        const out: any[] = [];
        const now = new Date();
        for (let i = 0; i < limit; i++) {
          const ev = await m.Event.findOneAndUpdate(
            { dispatchedAt: null, $or: [{ claimedUntil: null }, { claimedUntil: { $lt: now } }] },
            { $set: { claimedUntil: new Date(now.getTime() + leaseMs) } },
            { sort: { _id: 1 }, new: true },
          ).lean().exec();
          if (!ev) break;
          out.push(ev);
        }
        return out;
      }),
    markDispatched: (id: Types.ObjectId) =>
      runAsSystem('outbox.dispatch', () => m.Event.updateOne({ _id: id }, { $set: { dispatchedAt: new Date() } }).exec()),

    listConnectionsForScheduler: () =>
      runAsSystem('scheduler.listConnections', () =>
        m.IntegrationConnection.find({ status: { $ne: 'revoked' } }, { tenantId: 1, provider: 1, status: 1 }).lean().exec()),
  };
}
export type SystemOps = ReturnType<typeof createSystemOps>;

/** Base for BullMQ processors: every job payload must carry tenantId (spec §6.5). */
export async function runTenantJob<T>(payload: { tenantId?: string }, fn: () => Promise<T>): Promise<T> {
  if (!payload?.tenantId) throw new Error('Job rejected: missing tenantId');
  return runWithTenant(payload.tenantId, fn);
}
export { requireTenantId };

/** Lets feature code mint ids without importing mongoose directly. */
export const newObjectId = () => new Types.ObjectId();
