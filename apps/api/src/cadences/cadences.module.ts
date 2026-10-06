import { Body, Controller, Delete, Get, Inject, Injectable, Module, Param, Post, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { CadenceService, notFound } from '@leaddesk/domain';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { ConnectionsModule, REGISTRY } from '../connections/connections.module';
import { LeadsModule } from '../leads/leads.module';

class StepDto {
  @IsInt() @Min(0) @Max(60 * 24 * 60) offsetMinutes!: number;
  @IsIn(['task', 'message']) action!: 'task' | 'message';
  @IsOptional() @IsIn(['whatsapp', 'sms']) channel?: 'whatsapp' | 'sms';
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsIn(['call', 'whatsapp', 'sms', 'visit', 'other']) taskType?: 'call' | 'whatsapp' | 'sms' | 'visit' | 'other';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class CadenceDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => StepDto) steps!: StepDto[];
  @IsOptional() @IsObject() stopOn?: Record<string, boolean>;
  @IsOptional() @IsObject() enrollOn?: { statusIds?: string[]; outcomeIds?: string[] };
}
class CadencePatchDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StepDto) steps?: StepDto[];
  @IsOptional() @IsObject() stopOn?: Record<string, boolean>;
  @IsOptional() @IsObject() enrollOn?: { statusIds?: string[]; outcomeIds?: string[] };
  @IsOptional() @IsBoolean() active?: boolean;
}
class FirstTouchDto {
  @IsBoolean() enabled!: boolean;
  @IsIn(['whatsapp', 'sms']) channel!: 'whatsapp' | 'sms';
  @IsString() templateId!: string;
  @IsInt() @Min(0) @Max(1440) delayMinutes!: number;
}
class EnrollDto { @IsString() cadenceId!: string }

@Injectable()
export class CadenceFacade {
  readonly svc: CadenceService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(KEY_SERVICE) keys: KeyService, @Inject(REGISTRY) registry: ConnectorRegistry, readonly scope: ScopeService, readonly audit: AuditService) {
    this.svc = new CadenceService(db, keys, registry);
  }
}

/** Automation is configured by admins ("rules.manage"); agents can start/stop a cadence on a lead they can see. */
@Controller('v1')
export class CadenceController {
  constructor(private readonly f: CadenceFacade) {}

  @Get('cadences') @RequirePermission('leads.read')
  list() { return this.f.svc.list(); }

  @Post('cadences') @RequirePermission('rules.manage')
  async create(@Body() b: CadenceDto) { const c: any = await this.f.svc.create(b as any); await this.f.audit.record({ action: 'cadence.created', entity: 'cadence', entityId: String(c._id) }); return c; }

  @Put('cadences/:id') @RequirePermission('rules.manage')
  async update(@Param('id') id: string, @Body() b: CadencePatchDto) { const c = await this.f.svc.update(id, b as any); await this.f.audit.record({ action: 'cadence.updated', entity: 'cadence', entityId: id }); return c; }

  @Get('settings/first-touch') @RequirePermission('rules.manage')
  async firstTouch() { return (await this.f.svc.firstTouchSettings()) ?? { enabled: false }; }

  @Put('settings/first-touch') @RequirePermission('rules.manage')
  async setFirstTouch(@Body() b: FirstTouchDto) { const r = await this.f.svc.setFirstTouch(b); await this.f.audit.record({ action: 'first_touch.updated', entity: 'tenant', meta: { enabled: b.enabled, channel: b.channel } }); return r; }

  @Get('leads/:id/cadences') @RequirePermission('leads.read')
  async forLead(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.scope.assertVisible(u, await this.lead(id)); return this.f.svc.forLead(id); }

  @Post('leads/:id/cadences') @RequirePermission('leads.write')
  async enroll(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: EnrollDto) { await this.f.scope.assertVisible(u, await this.lead(id)); return this.f.svc.enroll(id, b.cadenceId); }

  @Delete('enrollments/:id') @RequirePermission('leads.write')
  async stop(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const e: any = await this.f.db.repos.enrollments.findById(id);
    if (e) await this.f.scope.assertVisible(u, await this.lead(String(e.leadId)));
    return this.f.svc.stopEnrollment(id);
  }

  private lead(id: string) { return this.f.db.repos.leads.findById(id).then((l: any) => { if (!l) throw notFound('Lead'); return l; }); }
}

@Module({ imports: [ConnectionsModule, LeadsModule], controllers: [CadenceController], providers: [CadenceFacade] })
export class CadencesModule {}
