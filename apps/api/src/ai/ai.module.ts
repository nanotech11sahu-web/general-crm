import { Body, Controller, Delete, Get, Inject, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ValidateNested, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { AiService, AutopilotService, DomainError, MessagingService, presentLead } from '@leaddesk/domain';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import type { ObjectStore } from '@leaddesk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { ConnectionsModule, REGISTRY } from '../connections/connections.module';
import { LeadsModule } from '../leads/leads.module';
import { DoModule, OBJECT_STORE } from '../do/do.module';

class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() killSwitch?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) dailyCap?: number;
  @IsOptional() @IsObject() features?: Record<string, number>;
  @IsOptional() @IsString() @MaxLength(600) scoringGuidance?: string;
  @IsOptional() @IsInt() @Min(7) @Max(90) revivalDays?: number;
  @IsOptional() @IsBoolean() callAnalysisConsent?: boolean;
}
class ChecklistItemDto { @IsString() @MaxLength(25) key!: string; @IsString() @MaxLength(160) question!: string }
class AutopilotDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) checklist?: ChecklistItemDto[];
  @IsOptional() @IsInt() maxMessages?: number;
  @IsOptional() @IsInt() graceSeconds?: number;
  @IsOptional() @IsString() @MaxLength(200) holdingMessage?: string;
}
class DraftDto { @IsOptional() @IsString() @MaxLength(300) instruction?: string }
class KbDto { @IsString() @MaxLength(120) title!: string; @IsString() @MaxLength(2000) text!: string; @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[]; @IsOptional() @IsBoolean() active?: boolean }
class NoteDto { @IsString() @MinLength(3) @MaxLength(1500) note!: string }
class SearchDto { @IsString() @MinLength(2) @MaxLength(300) q!: string }

@Injectable()
export class AiFacade {
  readonly svc: AiService; readonly autopilot: AutopilotService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(KEY_SERVICE) keys: KeyService, @Inject(REGISTRY) registry: ConnectorRegistry, @Inject(OBJECT_STORE) store: ObjectStore, readonly scope: ScopeService, readonly audit: AuditService) {
    this.svc = new AiService(db, keys, registry, { store });
    this.autopilot = new AutopilotService(db, this.svc, new MessagingService(db, keys, registry));
  }
  async visibleLead(u: AuthUser, id: string) {
    const l: any = await this.db.repos.leads.findOne({ _id: id, deletedAt: null });
    if (!l) throw new DomainError('not_found', 'Lead not found', undefined, 404);
    await this.scope.assertVisible(u, l);
    return l;
  }
  async visibleSuggestion(u: AuthUser, id: string) {
    const s: any = await this.db.repos.aiSuggestions.findById(id);
    if (!s) throw new DomainError('not_found', 'Suggestion not found', undefined, 404);
    if (s.leadId) await this.visibleLead(u, String(s.leadId));
    return s;
  }
}

/** Optional AI. Every route below is a suggestion generator or a human decision on one: nothing here writes lead data on its own. */
@Controller('v1/ai')
export class AiController {
  constructor(private readonly f: AiFacade) {}

  @Get('settings') @RequirePermission('leads.read')
  settings() { return this.f.svc.settings(); }

  @Put('settings') @RequirePermission('tenant.manage')
  async update(@Body() b: AiSettingsDto) { const s = await this.f.svc.updateSettings(b as any); await this.f.audit.record({ action: 'ai.settings_updated', entity: 'tenant', meta: b as any }); return s; }

  @Get('usage') @RequirePermission('pulse.view')
  usage() { return this.f.svc.usage(); }

  @Get('suggestions') @RequirePermission('leads.read')
  async suggestions(@CurrentUser() u: AuthUser, @Query('leadId') leadId?: string, @Query('status') status?: string) {
    if (leadId) await this.f.visibleLead(u, leadId);
    else if (u.role === 'agent') throw new DomainError('forbidden', 'Pass a leadId', undefined, 403);
    return this.f.svc.list({ leadId, status });
  }

  @Post('suggestions/:id/accept') @RequirePermission('leads.write')
  async accept(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleSuggestion(u, id); return this.f.svc.accept(id); }

  @Post('suggestions/:id/reject') @RequirePermission('leads.write')
  async reject(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleSuggestion(u, id); return this.f.svc.reject(id); }

  @Post('leads/:id/summary') @RequirePermission('leads.write')
  async summary(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.summarize(id); }
  @Post('leads/:id/autofill') @RequirePermission('leads.write')
  async autofill(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.autofill(id); }
  @Post('leads/:id/score') @RequirePermission('leads.write')
  async score(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.score(id); }
  @Post('leads/:id/assess') @RequirePermission('leads.write')
  async assess(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.assess(id); }
  @Post('leads/:id/next-action') @RequirePermission('leads.write')
  async nextAction(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: NoteDto) { await this.f.visibleLead(u, id); return this.f.svc.nextAction(id, b.note); }

  @Post('leads/:id/reply-draft') @RequirePermission('leads.write')
  async replyDraft(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: DraftDto) { await this.f.visibleLead(u, id); return this.f.svc.draftReply(id, b); }
  @Post('leads/:id/inbound') @RequirePermission('leads.write')
  async inbound(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.inboundIntel(id); }
  @Post('leads/:id/duplicates') @RequirePermission('leads.write')
  async duplicates(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.findDuplicates(id); }
  @Post('leads/:id/revive') @RequirePermission('leads.write')
  async revive(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.svc.revive(id); }

  // ---- qualification assistant: configured by admins, stoppable by anyone who can see the lead ----
  @Get('autopilot') @RequirePermission('leads.read')
  async autopilotConfig() { return (await this.f.svc.settings()).autopilot; }
  @Put('autopilot') @RequirePermission('tenant.manage')
  async setAutopilot(@Body() b: AutopilotDto) { const c = await this.f.svc.updateAutopilot(b); await this.f.audit.record({ action: 'ai.autopilot_configured', entity: 'tenant', meta: { items: c.checklist.length } }); return c; }
  @Post('leads/:id/autopilot/stop') @RequirePermission('leads.write')
  async stopAutopilot(@CurrentUser() u: AuthUser, @Param('id') id: string) { await this.f.visibleLead(u, id); return this.f.autopilot.stop(id); }

  // ---- call review (opt-in): managers only, because it exposes what was said on a call ----
  @Get('call-reviews') @RequirePermission('calls.listen')
  async callReviews(@CurrentUser() u: AuthUser) {
    const rows = await this.f.svc.callReviews();
    const out = [] as typeof rows;
    for (const r of rows) { try { await this.f.visibleLead(u, r.leadId); out.push(r); } catch { /* not in this manager's scope */ } }
    return out;
  }
  @Post('calls/:id/analyze') @RequirePermission('calls.listen')
  async analyzeCall(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const c: any = await this.f.db.repos.callSessions.findById(id); if (!c) throw new DomainError('not_found', 'Call not found', undefined, 404);
    await this.f.visibleLead(u, String(c.leadId));
    const a = await this.f.svc.analyzeCall(id); await this.f.audit.record({ action: 'ai.call_analysis_requested', entity: 'call', entityId: id });
    return a;
  }
  @Get('calls/:id/analysis') @RequirePermission('calls.listen')
  async callAnalysis(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const a: any = await this.f.svc.callAnalysis(id); await this.f.visibleLead(u, a.leadId);
    await this.f.audit.record({ action: 'ai.transcript_viewed', entity: 'call', entityId: id });
    return a;
  }

  // ---- knowledge base: facts the drafter may rely on (admins write, everyone who can reply may read) ----
  @Get('knowledge') @RequirePermission('leads.read')
  knowledge() { return this.f.svc.kbList(); }
  @Post('knowledge') @RequirePermission('rules.manage')
  async kbCreate(@Body() b: KbDto) { const e: any = await this.f.svc.kbSave(b); await this.f.audit.record({ action: 'ai.knowledge_saved', entity: 'knowledge', entityId: String(e._id) }); return e; }
  @Put('knowledge/:id') @RequirePermission('rules.manage')
  async kbUpdate(@Param('id') id: string, @Body() b: KbDto) { const e = await this.f.svc.kbSave({ ...b, id }); await this.f.audit.record({ action: 'ai.knowledge_saved', entity: 'knowledge', entityId: id }); return e; }
  @Delete('knowledge/:id') @RequirePermission('rules.manage')
  async kbDelete(@Param('id') id: string) { await this.f.audit.record({ action: 'ai.knowledge_deleted', entity: 'knowledge', entityId: id }); return this.f.svc.kbDelete(id); }

  /** The model returns a validated filter; the server builds the query, ANDed with the caller's visibility scope. */
  @Post('search') @RequirePermission('leads.read')
  async search(@CurrentUser() u: AuthUser, @Body() b: SearchDto) {
    const { filter, interpreted } = await this.f.svc.searchFilter(b.q);
    const q = await this.f.svc.compileFilter(filter, { userId: u.userId, scope: await this.f.scope.leadFilter(u) });
    const rows: any[] = await this.f.db.repos.leads.find(q, { sort: { createdAt: -1 }, limit: 50 });
    return { interpreted, filter, total: await this.f.db.repos.leads.count(q), items: rows.map((l) => presentLead(l, u.role)) };
  }

  @Post('imports/:id/mapping') @RequirePermission('imports.manage')
  async importMapping(@Param('id') id: string) {
    const job: any = await this.f.db.repos.importJobs.findById(id);
    if (!job) throw new DomainError('not_found', 'Import not found', undefined, 404);
    const rows: any[] = await this.f.db.repos.importRows.find({ jobId: job._id }, { sort: { rowNo: 1 }, limit: 5 });
    return this.f.svc.importMapping(job.headers, rows.map((r) => r.data));
  }
}

@Module({ imports: [ConnectionsModule, LeadsModule, DoModule], controllers: [AiController], providers: [AiFacade] })
export class AiModule {}
