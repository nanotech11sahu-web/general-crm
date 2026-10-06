import { toObjectId, withTransaction, getContext, type TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { LeadService } from './lead-service';

export interface OffboardPlan { reassignTo?: string; poolUserIds?: string[] }

/**
 * One-click offboarding (spec §7): deactivate + revoke sessions in ONE transaction,
 * then reassign open leads in short chunked transactions. Re-runnable: it always
 * selects whatever the user still owns, so a crash mid-way is safe to resume.
 * (Tasks and cadences join in Phase 3.)
 */
export class OffboardService {
  constructor(private readonly db: TenantDb, private readonly leads = new LeadService(db)) {}

  async offboard(userId: string, plan: OffboardPlan = {}) {
    const r = this.db.repos;
    const m: any = await r.memberships.findOne({ userId });
    if (!m) throw notFound('User');
    if (m.role === 'owner') throw new DomainError('cannot_offboard_owner', 'The workspace owner cannot be offboarded');
    if (String(getContext()?.userId) === userId) throw new DomainError('cannot_offboard_self', 'You cannot offboard yourself');

    const pool = await this.resolvePool(userId, plan);
    await withTransaction(this.db.conn, async () => {
      await r.memberships.updateOne({ _id: m._id }, { $set: { status: 'inactive' } });
      await r.refreshTokens.updateMany({ userId: toObjectId(userId), revokedAt: null }, { $set: { revokedAt: new Date() } });
      await r.audit.record({ action: 'user.offboarded', entity: 'user', entityId: userId, meta: { plan } });
      await r.outbox.add('user.offboarded', userId, {});
    });

    let reassigned = 0, unassigned = 0, rr = 0;
    const openStatusIds = (await r.statuses.find({ kind: 'open' })).map((s: any) => s._id);
    for (;;) {
      const batch: any[] = await r.leads.find({ ownerId: toObjectId(userId), deletedAt: null, $or: [{ statusId: { $in: openStatusIds } }, { statusId: null }] }, { limit: 200, sort: { _id: 1 } });
      if (!batch.length) break;
      for (const lead of batch) {
        const target = pool.length ? pool[rr++ % pool.length] : null; // round-robin over the pool
        await this.leads.assign(String(lead._id), target, undefined);
        if (target) reassigned++; else unassigned++;
      }
    }
    return { reassigned, unassigned };
  }

  private async resolvePool(userId: string, plan: OffboardPlan): Promise<string[]> {
    const r = this.db.repos;
    const wanted = plan.reassignTo ? [plan.reassignTo] : plan.poolUserIds ?? [];
    if (!wanted.length) return [];
    const ms: any[] = await r.memberships.find({ userId: { $in: wanted.map(toObjectId) }, status: 'active' });
    if (ms.length !== new Set(wanted).size || wanted.includes(userId)) throw new DomainError('invalid_pool', 'Reassignment targets must be other active members');
    return wanted;
  }
}
