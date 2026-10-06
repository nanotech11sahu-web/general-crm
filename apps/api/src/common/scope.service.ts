import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { defaultScope } from '@leaddesk/shared';
import { TENANT_DB } from '@leaddesk/platform';
import type { AuthUser } from './auth.types';

/** Row visibility (spec §7): own | team | all, applied in the query filter, not just the UI. */
@Injectable()
export class ScopeService {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}

  async leadFilter(u: AuthUser): Promise<Record<string, unknown>> {
    const scope = defaultScope(u.role);
    if (scope === 'all') return {};
    const me = toObjectId(u.userId);
    if (scope === 'own') return { ownerId: me };
    const m: any = await this.db.repos.memberships.findOne({ userId: u.userId, status: 'active' });
    return m?.teamId ? { $or: [{ teamId: m.teamId }, { ownerId: me }] } : { ownerId: me };
  }

  /** Throws 403-as-404-equivalent for rows outside the caller's scope. */
  async assertVisible(u: AuthUser, lead: any) {
    const f: any = await this.leadFilter(u);
    const ok = !Object.keys(f).length
      || (f.ownerId && String(lead.ownerId) === String(f.ownerId))
      || (f.$or && f.$or.some((c: any) => (c.teamId && String(lead.teamId) === String(c.teamId)) || (c.ownerId && String(lead.ownerId) === String(c.ownerId))));
    if (!ok) throw new ForbiddenException('Lead is outside your visibility scope');
  }
}
