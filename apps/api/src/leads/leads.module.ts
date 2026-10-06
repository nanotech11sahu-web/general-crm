import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Inject, Injectable, Module, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength, ValidateNested, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { csvCell, DomainError, LeadSearch, LeadService, presentLead, QUERY_KEYS, type LeadQuery } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { can } from '@leaddesk/shared';
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
class BulkDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @IsString({ each: true }) ids!: string[];
  @IsIn(['assign', 'status', 'tag', 'delete']) action!: 'assign' | 'status' | 'tag' | 'delete';
  @IsOptional() @IsString() ownerId?: string;
  @IsOptional() @IsString() statusId?: string;
  @IsOptional() @IsString() lostReasonId?: string;
  @IsOptional() @IsString() tag?: string;
}
class ViewDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsObject() filter!: Record<string, unknown>;
  @IsOptional() @IsBoolean() shared?: boolean;
}
class AssignDto { @IsOptional() @IsString() ownerId?: string | null }
class LostReasonDto { @IsString() @MinLength(1) label!: string }

@Injectable()
export class LeadsFacade {
  readonly svc: LeadService;
  readonly search: LeadSearch;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly scope: ScopeService, readonly audit: AuditService) { this.svc = new LeadService(db); this.search = new LeadSearch(db); }

  /** Validates a LeadQuery from untrusted input (query string / saved view) against the whitelist. */
  parseQuery(raw: Record<string, any>, strict = false): LeadQuery {
    const q: Record<string, unknown> = {};
    for (const k of Object.keys(raw)) {
      if (!QUERY_KEYS.includes(k as any)) {
        if (strict) throw new DomainError('invalid_query', `Unknown filter: ${k}`);
        continue; // list endpoint also carries cursor/limit/viewId
      }
      let v = raw[k];
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new DomainError('invalid_query', `Invalid value for ${k}`);
      if (k === 'unassigned') v = v === true || v === 'true';
      if (k === 'untouchedDays') v = Number(v);
      q[k] = v;
    }
    return q as LeadQuery;
  }

  async visible(u: AuthUser, id: string) {
    const lead = await this.svc.get(id);
    await this.scope.assertVisible(u, lead);
    return lead;
  }
}

@Controller('v1')
export class LeadsController {
  constructor(private readonly f: LeadsFacade) {}

  @Get('leads') @RequirePermission('leads.read')
  async list(@CurrentUser() u: AuthUser, @Query() qs: Record<string, any>) {
    let q = this.f.parseQuery(qs);
    if (qs.viewId) {
      const v: any = await this.f.db.repos.views.findOne({ _id: qs.viewId, $or: [{ shared: true }, { ownerId: toObjectId(u.userId) }] });
      if (!v) throw new DomainError('not_found', 'View not found', undefined, 404);
      q = { ...this.f.parseQuery(v.filter, true), ...q };
    }
    return this.f.search.list(q, { role: u.role, scope: await this.f.scope.leadFilter(u), cursor: qs.cursor, limit: qs.limit ? Number(qs.limit) : undefined });
  }

  /** Manager/admin only; audited; CSV-injection safe. Agents never get bulk data (custody). */
  @Get('leads-export') @RequirePermission('leads.export')
  async export(@CurrentUser() u: AuthUser, @Query() qs: Record<string, any>, @Res() res: Response) {
    const q = this.f.parseQuery(qs);
    const rows: any[] = await this.f.search.exportRows(q, { role: u.role, scope: await this.f.scope.leadFilter(u) });
    await this.f.audit.record({ action: 'leads.exported', entity: 'lead', meta: { count: rows.length, filter: q } });
    const head = ['id', 'name', 'phones', 'emails', 'city', 'tags', 'createdAt'];
    const lines = [head.join(',')].concat(rows.map((l) => [
      l._id, l.displayName,
      l.contacts.filter((c: any) => c.kind === 'phone').map((c: any) => c.valueNorm).join(' '),
      l.contacts.filter((c: any) => c.kind === 'email').map((c: any) => c.valueNorm).join(' '),
      l.city, (l.tags ?? []).join(' '), l.createdAt,
    ].map(csvCell).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(lines.join('\n'));
  }

  @Post('leads/bulk') @RequirePermission('leads.write')
  async bulk(@CurrentUser() u: AuthUser, @Body() b: BulkDto) {
    if ((b.action === 'assign' || b.action === 'delete') && !can(u.role, 'leads.reassign')) throw new ForbiddenException(`Missing permission: leads.reassign`);
    const scope = await this.f.scope.leadFilter(u);
    const visible: any[] = await this.f.db.repos.leads.find({ $and: [{ _id: { $in: b.ids.map(toObjectId) }, deletedAt: null }, scope] }, { projection: { _id: 1 } });
    const ok = new Set(visible.map((l) => String(l._id)));
    const failed: { id: string; reason: string }[] = b.ids.filter((id) => !ok.has(id)).map((id) => ({ id, reason: 'not found or not visible' }));
    let updated = 0;
    for (const id of ok) {
      try {
        if (b.action === 'assign') await this.f.svc.assign(id, b.ownerId ?? null);
        else if (b.action === 'status') await this.f.svc.changeStatus(id, b.statusId!, { lostReasonId: b.lostReasonId });
        else if (b.action === 'tag') { if (!b.tag) throw new BadRequestException('tag required'); await this.f.db.repos.leads.updateOne({ _id: id }, { $addToSet: { tags: b.tag } }); }
        else await this.f.svc.softDelete(id);
        updated++;
      } catch (e: any) { failed.push({ id, reason: e?.message ?? 'failed' }); }
    }
    await this.f.audit.record({ action: `leads.bulk_${b.action}`, entity: 'lead', meta: { requested: b.ids.length, updated } });
    return { updated, failed };
  }

  @Post('leads/:id/assign') @RequirePermission('leads.reassign')
  async assign(@Param('id') id: string, @Body() b: AssignDto) {
    await this.f.svc.assign(id, b.ownerId ?? null);
    await this.f.audit.record({ action: 'lead.assigned', entity: 'lead', entityId: id, meta: { ownerId: b.ownerId ?? null } });
    return { ok: true };
  }

  // ---- saved views ----
  @Get('views') @RequirePermission('leads.read')
  views(@CurrentUser() u: AuthUser) { return this.f.db.repos.views.find({ $or: [{ shared: true }, { ownerId: toObjectId(u.userId) }] }); }

  @Post('views') @RequirePermission('leads.read')
  createView(@CurrentUser() u: AuthUser, @Body() b: ViewDto) {
    if (b.shared && !can(u.role, 'leads.reassign')) throw new ForbiddenException('Only managers and admins can share views');
    const filter = this.f.parseQuery(b.filter as any, true); // validated now so stored views are always safe
    return this.f.db.repos.views.create({ name: b.name, filter, shared: !!b.shared, ownerId: toObjectId(u.userId) });
  }

  @Delete('views/:id') @RequirePermission('leads.read')
  async deleteView(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v: any = await this.f.db.repos.views.findById(id);
    if (!v) throw new DomainError('not_found', 'View not found', undefined, 404);
    if (String(v.ownerId) !== u.userId && !can(u.role, 'tenant.manage')) throw new ForbiddenException();
    await this.f.db.repos.views.deleteOne({ _id: id });
    return { ok: true };
  }

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
