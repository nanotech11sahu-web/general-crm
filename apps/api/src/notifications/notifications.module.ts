import { Controller, Get, Inject, Module, Param, Post } from '@nestjs/common';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { can } from '@leaddesk/shared';
import { TENANT_DB } from '@leaddesk/platform';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser } from '../common/guards';

@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}

  /** Personal notifications, plus admin-audience ones (connection alerts) for people who can manage connections. */
  private filter(u: AuthUser) {
    const mine = { audience: 'user', userId: toObjectId(u.userId) };
    const ors: Record<string, unknown>[] = [mine];
    if (can(u.role, 'connections.manage')) ors.push({ audience: 'admins' });
    if (can(u.role, 'leads.reassign')) ors.push({ audience: 'managers' });
    return ors.length > 1 ? { $or: ors } : mine;
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    return this.db.repos.notifications.find(this.filter(u), { sort: { createdAt: -1 }, limit: 100 });
  }

  @Post(':id/read')
  async read(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.db.repos.notifications.updateOne({ $and: [{ _id: id }, this.filter(u)] }, { $set: { readAt: new Date() } });
    return { ok: r.matchedCount === 1 };
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
