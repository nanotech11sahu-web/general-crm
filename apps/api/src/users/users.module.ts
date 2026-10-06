import { Body, Controller, Delete, Get, Inject, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsDateString, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Patch } from '@nestjs/common';
import { DomainError, OffboardService } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { MembershipCache, RequirePermission } from '../common/guards';

class OffboardDto {
  @IsOptional() @IsString() reassignTo?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) poolUserIds?: string[];
}

class MemberProfileDto {
  @IsOptional() @IsObject() workingHours?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) languages?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(10000) maxOpenLeads?: number;
  @IsOptional() @IsDateString() onLeaveUntil?: string | null;
  @IsOptional() @IsString() teamId?: string | null;
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

  /** Routing inputs: working hours, languages, skills, capacity, leave, team. */
  async updateProfile(userId: string, p: MemberProfileDto) {
    const set: Record<string, unknown> = {};
    for (const k of ['workingHours', 'languages', 'skills', 'maxOpenLeads'] as const) if (p[k] !== undefined) set[k] = p[k];
    if (p.onLeaveUntil !== undefined) set.onLeaveUntil = p.onLeaveUntil ? new Date(p.onLeaveUntil) : null;
    if (p.teamId !== undefined) {
      if (p.teamId && !(await this.db.repos.teams.findById(p.teamId))) throw new DomainError('not_found', 'Team not found', undefined, 404);
      set.teamId = p.teamId ? toObjectId(p.teamId) : null;
    }
    const r = await this.db.repos.memberships.updateOne({ userId: toObjectId(userId) }, { $set: set });
    if (r.matchedCount !== 1) throw new DomainError('not_found', 'User not found', undefined, 404);
    return { ok: true };
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
  @Patch(':id/profile') @RequirePermission('users.manage')
  profile(@Param('id') id: string, @Body() b: MemberProfileDto) { return this.svc.updateProfile(id, b); }

  @Post(':id/offboard') @RequirePermission('users.offboard')
  offboard(@Param('id') id: string, @Body() b: OffboardDto) { return this.svc.offboard(id, b); }
}

class TeamDto { @IsString() @MinLength(1) @MaxLength(80) name!: string; @IsOptional() @IsString() leadUserId?: string | null }

/** Teams scope what managers see and feed team-pool routing rules. */
@Controller('v1/teams')
export class TeamsController {
  constructor(private readonly svc: UsersService) {}
  @Get() @RequirePermission('leads.reassign')
  async list() {
    const [teams, ms]: [any[], any[]] = await Promise.all([this.svc.db.repos.teams.find({}, { sort: { name: 1 } }), this.svc.db.repos.memberships.find({ status: 'active' })]);
    return teams.map((t) => ({ id: String(t._id), name: t.name, leadUserId: t.leadUserId ? String(t.leadUserId) : null, members: ms.filter((m) => String(m.teamId) === String(t._id)).length }));
  }
  @Post() @RequirePermission('users.manage')
  async create(@Body() b: TeamDto) { const t: any = await this.svc.db.repos.teams.create({ name: b.name, ...(b.leadUserId ? { leadUserId: toObjectId(b.leadUserId) } : {}) }); return { id: String(t._id), name: t.name }; }
  @Put(':id') @RequirePermission('users.manage')
  async update(@Param('id') id: string, @Body() b: TeamDto) {
    const r = await this.svc.db.repos.teams.updateOne({ _id: id }, { $set: { name: b.name, leadUserId: b.leadUserId ? toObjectId(b.leadUserId) : null } });
    if (r.matchedCount !== 1) throw new DomainError('not_found', 'Team not found', undefined, 404);
    return { ok: true };
  }
  @Delete(':id') @RequirePermission('users.manage')
  async remove(@Param('id') id: string) {
    await this.svc.db.repos.memberships.updateMany({ teamId: toObjectId(id) }, { $set: { teamId: null } });
    await this.svc.db.repos.teams.deleteOne({ _id: id }); this.svc.cache.clear();
    return { ok: true };
  }
}

@Module({ controllers: [UsersController, TeamsController], providers: [UsersService] })
export class UsersModule {}
