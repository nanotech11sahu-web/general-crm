import { Body, Controller, Get, Inject, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { AiService, DomainError, presentLead } from '@leaddesk/domain';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { ScopeService } from '../common/scope.service';
import { ConnectionsModule, REGISTRY } from '../connections/connections.module';
import { LeadsModule } from '../leads/leads.module';

class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() killSwitch?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) dailyCap?: number;
  @IsOptional() @IsObject() features?: Record<string, number>;
}
class NoteDto { @IsString() @MinLength(3) @MaxLength(1500) note!: string }
class SearchDto { @IsString() @MinLength(2) @MaxLength(300) q!: string }

@Injectable()
export class AiFacade {
  readonly svc: AiService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(KEY_SERVICE) keys: KeyService, @Inject(REGISTRY) registry: ConnectorRegistry, readonly scope: ScopeService, readonly audit: AuditService) {
    this.svc = new AiService(db, keys, registry);
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

@Module({ imports: [ConnectionsModule, LeadsModule], controllers: [AiController], providers: [AiFacade] })
export class AiModule {}
