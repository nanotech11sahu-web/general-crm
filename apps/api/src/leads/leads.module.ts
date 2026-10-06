import { Body, Controller, Delete, Get, Inject, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { LeadService, presentLead } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { AuditService } from '../audit/audit.service';

class ContactDto {
  @IsString() @MaxLength(200) value!: string;
  @IsOptional() @IsIn(['phone', 'email']) kind?: 'phone' | 'email';
}
class CreateLeadDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => ContactDto) contacts!: ContactDto[];
  @IsOptional() @IsString() campaign?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() budgetText?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsObject() custom?: Record<string, unknown>;
  @IsOptional() @IsString() externalRef?: string;
}
class UpdateLeadDto {
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() budgetText?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsObject() custom?: Record<string, unknown>;
  @IsOptional() @IsDateString() nextActionAt?: string;
}
class StatusDto { @IsString() statusId!: string; @IsOptional() @IsString() lostReasonId?: string }
class NoteDto { @IsString() @MinLength(1) @MaxLength(5000) text!: string }
class MergeDto { @IsString() loserId!: string }
class StatusDefDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['open', 'won', 'lost']) kind!: 'open' | 'won' | 'lost';
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) requiresFields?: string[];
}
class CustomFieldDto {
  @IsString() @MinLength(1) key!: string;
  @IsString() @MinLength(1) label!: string;
  @IsIn(['text', 'number', 'select', 'date', 'boolean']) type!: 'text' | 'number' | 'select' | 'date' | 'boolean';
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsBoolean() showInList?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) requiredInStatusIds?: string[];
}
class LostReasonDto { @IsString() @MinLength(1) label!: string }

@Injectable()
export class LeadsFacade {
  readonly svc: LeadService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly scope: ScopeService, readonly audit: AuditService) { this.svc = new LeadService(db); }

  async visible(u: AuthUser, id: string) {
    const lead = await this.svc.get(id);
    await this.scope.assertVisible(u, lead);
    return lead;
  }
}

@Controller('v1')
export class LeadsController {
  constructor(private readonly f: LeadsFacade) {}

  @Post('leads') @RequirePermission('leads.write')
  create(@CurrentUser() u: AuthUser, @Body() b: CreateLeadDto) {
    // agents own what they create; routing (Phase 3) assigns everything else
    return this.f.svc.intake({ ...b, source: { kind: 'manual', name: 'Manual entry' }, ownerId: u.role === 'agent' ? u.userId : undefined });
  }

  @Get('leads/:id') @RequirePermission('leads.read')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return presentLead(await this.f.visible(u, id), u.role); }

  @Patch('leads/:id') @RequirePermission('leads.write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: UpdateLeadDto) {
    await this.f.visible(u, id);
    return presentLead(await this.f.svc.update(id, { ...b, nextActionAt: b.nextActionAt ? new Date(b.nextActionAt) : undefined }), u.role);
  }

  @Post('leads/:id/status') @RequirePermission('leads.write')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: StatusDto) {
    await this.f.visible(u, id);
    return presentLead(await this.f.svc.changeStatus(id, b.statusId, { lostReasonId: b.lostReasonId }), u.role);
  }

  @Post('leads/:id/notes') @RequirePermission('leads.write')
  async note(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteDto) { await this.f.visible(u, id); await this.f.svc.addNote(id, b.text); return { ok: true }; }

  @Get('leads/:id/timeline') @RequirePermission('leads.read')
  async timeline(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    await this.f.visible(u, id);
    return this.f.svc.timeline(id, { before, limit: limit ? Number(limit) : undefined });
  }

  @Delete('leads/:id') @RequirePermission('leads.reassign')
  async remove(@Param('id') id: string) {
    await this.f.svc.softDelete(id);
    await this.f.audit.record({ action: 'lead.deleted', entity: 'lead', entityId: id });
    return { ok: true };
  }

  @Post('leads/:id/merge') @RequirePermission('leads.reassign')
  async merge(@Param('id') id: string, @Body() b: MergeDto) {
    const r = await this.f.svc.merge(id, b.loserId);
    await this.f.audit.record({ action: 'lead.merged', entity: 'lead', entityId: id, meta: { loserId: b.loserId } });
    return r;
  }

  @Post('merges/:id/undo') @RequirePermission('leads.reassign')
  async undo(@Param('id') id: string) {
    const r = await this.f.svc.undoMerge(id);
    await this.f.audit.record({ action: 'lead.merge_undone', entity: 'merge', entityId: id });
    return r;
  }

  // ---- configuration (admin) ----
  @Get('statuses') @RequirePermission('leads.read')
  statuses() { return this.f.db.repos.statuses.find({}, { sort: { position: 1 } }); }

  @Post('statuses') @RequirePermission('statuses.manage')
  async addStatus(@Body() b: StatusDefDto) {
    const n = await this.f.db.repos.statuses.count();
    return this.f.db.repos.statuses.create({ ...b, requiresFields: b.requiresFields ?? [], position: n });
  }

  @Get('lost-reasons') @RequirePermission('leads.read')
  lostReasons() { return this.f.db.repos.lostReasons.find(); }

  @Post('lost-reasons') @RequirePermission('statuses.manage')
  addLostReason(@Body() b: LostReasonDto) { return this.f.db.repos.lostReasons.create(b); }

  @Get('custom-fields') @RequirePermission('leads.read')
  customFields() { return this.f.db.repos.customFields.find(); }

  @Post('custom-fields') @RequirePermission('statuses.manage')
  addCustomField(@Body() b: CustomFieldDto) { return this.f.db.repos.customFields.create({ ...b, options: b.options ?? [], requiredInStatusIds: b.requiredInStatusIds ?? [] }); }
}

@Module({ controllers: [LeadsController], providers: [LeadsFacade, ScopeService], exports: [LeadsFacade, ScopeService] })
export class LeadsModule {}
