import { Body, Controller, Get, Inject, Injectable, Module, Param, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { OffboardService } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { MembershipCache, RequirePermission } from '../common/guards';

class OffboardDto {
  @IsOptional() @IsString() reassignTo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) poolUserIds?: string[];
}

@Injectable()
export class UsersService {
  readonly offboarding: OffboardService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly cache: MembershipCache) { this.offboarding = new OffboardService(db); }

  async list() {
    const ms: any[] = await this.db.repos.memberships.find({}, { sort: { _id: 1 } });
    const users: any[] = await this.db.models.User.find({ _id: { $in: ms.map((m) => m.userId) } }, { name: 1, email: 1 }).lean().exec();
    const by = new Map(users.map((u) => [String(u._id), u]));
    return ms.map((m) => ({ userId: String(m.userId), role: m.role, status: m.status, teamId: m.teamId ? String(m.teamId) : null, name: by.get(String(m.userId))?.name, email: by.get(String(m.userId))?.email }));
  }

  async offboard(userId: string, plan: OffboardDto) {
    const m: any = await this.db.repos.memberships.findOne({ userId: toObjectId(userId) });
    const out = await this.offboarding.offboard(userId, plan);
    if (m) this.cache.invalidate(String(m._id));
    return out;
  }
}

@Controller('v1/users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}
  @Get() @RequirePermission('leads.reassign') list() { return this.svc.list(); }
  @Post(':id/offboard') @RequirePermission('users.offboard')
  offboard(@Param('id') id: string, @Body() b: OffboardDto) { return this.svc.offboard(id, b); }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
