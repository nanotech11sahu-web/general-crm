import { Body, Controller, Get, Inject, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { PresenceService, RoutingService, SlaService, type RuleAction, type RuleConditions } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { requireTenantId, toObjectId, type TenantDb } from '@leaddesk/db';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import { LeadsModule } from '../leads/leads.module';

class RuleDto {
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsObject() conditions?: RuleConditions;
  @IsObject() action!: RuleAction;
  @IsOptional() @IsBoolean() active?: boolean;
}
class RulesDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RuleDto) rules!: RuleDto[];
  @IsOptional() @IsObject() default?: RuleAction | null;
}
class SlaDto {
  @IsString() @MaxLength(100) name!: string;
  @IsInt() @Min(0) @Max(7 * 86400) claimSeconds!: number;
  @IsInt() @Min(0) @Max(30 * 86400) firstContactSeconds!: number;
  @IsOptional() @IsInt() @Min(0) @Max(50) maxReassignments?: number;
  @IsOptional() @IsObject() appliesTo?: { sourceKinds?: string[] };
  @IsOptional() @IsBoolean() active?: boolean;
}
class SlaListDto { @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SlaDto) policies!: SlaDto[] }
class PresenceDto { @IsIn(['online', 'away', 'offline']) state!: 'online' | 'away' | 'offline' } // on_call is set by the system, never by the client

@Injectable()
export class RoutingFacade {
  readonly routing: RoutingService; readonly presence: PresenceService; readonly sla: SlaService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly audit: AuditService, readonly scope: ScopeService) {
    this.routing = new RoutingService(db); this.presence = new PresenceService(db); this.sla = new SlaService(db);
  }
}

@Controller('v1')
export class RoutingController {
  constructor(private readonly f: RoutingFacade) {}

  @Get('rules/assignment') @RequirePermission('leads.reassign')
  async rules() {
    const t: any = await this.f.db.models.Tenant.findById(requireTenantId()).lean().exec();
    return { rules: await this.f.routing.rules(), default: t?.settings?.routing?.default ?? null };
  }

  @Put('rules/assignment') @RequirePermission('rules.manage')
  async setRules(@Body() b: RulesDto) {
    const out = await this.f.routing.setRules(b.rules, b.default ?? null);
    await this.f.audit.record({ action: 'routing.rules_replaced', entity: 'rules', meta: { count: b.rules.length } });
    return out;
  }

  @Get('sla') @RequirePermission('leads.reassign')
  sla() { return this.f.db.repos.slaPolicies.find({}, { sort: { _id: 1 } }); }

  @Put('sla') @RequirePermission('rules.manage')
  async setSla(@Body() b: SlaListDto) {
    const out = await this.f.routing.setSlaPolicies(b.policies);
    await this.f.audit.record({ action: 'sla.policies_replaced', entity: 'sla', meta: { count: b.policies.length } });
    return out;
  }

  @Put('me/presence') @RequirePermission('leads.read')
  async setPresence(@CurrentUser() u: AuthUser, @Body() b: PresenceDto) { await this.f.presence.set(u.userId, b.state); return { state: b.state }; }

  @Get('team/presence') @RequirePermission('leads.reassign')
  async team() {
    const ms: any[] = await this.f.db.repos.memberships.find({ status: 'active' });
    const pres = await this.f.presence.get(ms.map((m) => String(m.userId)));
    const users: any[] = await this.f.db.models.User.find({ _id: { $in: ms.map((m) => m.userId) } }, { name: 1 }).lean().exec();
    const name = new Map(users.map((x) => [String(x._id), x.name]));
    return ms.map((m) => ({ userId: String(m.userId), name: name.get(String(m.userId)), role: m.role, state: pres[String(m.userId)] ?? 'offline' }));
  }

  @Post('leads/:id/claim') @RequirePermission('leads.write')
  async claim(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.f.sla.claim(id, u.userId); }

  @Get('leads/:id/routing') @RequirePermission('leads.read')
  async decisions(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const lead: any = await this.f.db.repos.leads.findById(id);
    if (!lead) return [];
    await this.f.scope.assertVisible(u, lead);
    return this.f.routing.decisions(String(toObjectId(id)));
  }
}

@Module({ imports: [LeadsModule], controllers: [RoutingController], providers: [RoutingFacade] })
export class RoutingModule {}
