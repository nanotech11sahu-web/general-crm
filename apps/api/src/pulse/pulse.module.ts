import { BadRequestException, Body, Controller, Get, Header, Inject, Injectable, Module, Put, Query, Res } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { PulseService, type Range } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import type { TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';

class PulseSettingsDto {
  @IsOptional() @IsBoolean() gamification?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(500) dailyGoal?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) digestHour?: number;
  @IsOptional() @IsInt() @Min(1) @Max(720) untouchedHours?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) abandonedDays?: number;
}

const range = (v?: string): Range => { if (v === undefined) return '7d'; if (v === 'today' || v === '7d' || v === '30d') return v; throw new BadRequestException('range must be today, 7d or 30d'); };
const num = (v: string | undefined, lo: number, hi: number) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new BadRequestException(`value must be an integer between ${lo} and ${hi}`); return n; };

@Injectable()
export class PulseFacade {
  readonly svc: PulseService;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly audit: AuditService) { this.svc = new PulseService(db); }
}

/** Manager analytics are tenant-wide (`pulse.view`); the agent view is the caller's own goal + the public follow-up leaderboard. */
@Controller('v1/pulse')
export class PulseController {
  constructor(private readonly f: PulseFacade) {}

  @Get('kpis') @RequirePermission('pulse.view')
  kpis(@Query('range') r?: string) { return this.f.svc.kpis(range(r)); }

  @Get('team') @RequirePermission('pulse.view')
  team() { return this.f.svc.team(); }

  @Get('leakage') @RequirePermission('pulse.view')
  leakage(@Query('untouchedHours') uh?: string, @Query('abandonedDays') ad?: string, @Query('range') r?: string) { return this.f.svc.leakage({ untouchedHours: num(uh, 1, 720), abandonedDays: num(ad, 1, 365), range: range(r) }); }

  @Get('sources') @RequirePermission('pulse.view')
  sources(@Query('groupBy') g?: string, @Query('range') r?: string) {
    if (g !== undefined && !['source', 'campaign', 'ad'].includes(g)) throw new BadRequestException('groupBy must be source, campaign or ad');
    return this.f.svc.sources({ groupBy: g as any, range: r === undefined ? '30d' : range(r) });
  }

  @Get('agents') @RequirePermission('pulse.view')
  agents(@Query('range') r?: string) { return this.f.svc.agents(range(r)); }

  @Get('insights') @RequirePermission('pulse.view')
  insights() { return this.f.svc.insights(); }

  @Get('trend') @RequirePermission('pulse.view')
  trend(@Query('days') d?: string) { return this.f.svc.trend(num(d, 1, 90) ?? 30); }

  @Get('settings') @RequirePermission('pulse.view')
  settings() { return this.f.svc.settings(); }

  @Put('settings') @RequirePermission('tenant.manage')
  async updateSettings(@Body() b: PulseSettingsDto) { const s = await this.f.svc.updateSettings(b); await this.f.audit.record({ action: 'pulse.settings_updated', entity: 'tenant', meta: b as any }); return s; }

  /** Agents: own daily goal ring + streak + the team's follow-up leaderboard (off when the tenant disables gamification). */
  @Get('me') @RequirePermission('leads.read')
  me(@CurrentUser() u: AuthUser) { return this.f.svc.me(u.userId); }

  /** Admin/owner only and audited: exports leave the system. */
  @Get('export') @RequirePermission('tenant.manage') @Header('Cache-Control', 'no-store')
  async export(@Query('report') report: string, @Query('range') r: string | undefined, @Res() res: Response) {
    const rg = range(r); let rows: Record<string, unknown>[];
    if (report === 'agents') rows = (await this.f.svc.agents(rg)).rows as any;
    else if (report === 'sources') rows = (await this.f.svc.sources({ range: rg })).rows as any;
    else if (report === 'leakage') { const l = await this.f.svc.leakage({ range: rg }); rows = [...l.untouched.leads.map((x) => ({ bucket: 'untouched', ...x })), ...l.abandoned.leads.map((x) => ({ bucket: 'abandoned', ...x })), ...l.lateFirstContact.leads.map((x) => ({ bucket: 'late_first_contact', leadId: x.leadId, name: x.name, ownerId: x.ownerId })), ...l.missedFollowUps.leads.map((x) => ({ bucket: 'missed_followup', leadId: x.leadId, name: x.name, ownerId: x.ownerId }))]; }
    else throw new BadRequestException('report must be agents, sources or leakage');
    await this.f.audit.record({ action: 'pulse.exported', entity: 'pulse', meta: { report, range: rg, rows: rows.length } });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="pulse-${report}-${rg}.csv"`);
    res.end(this.f.svc.csv(rows));
  }
}

@Module({ controllers: [PulseController], providers: [PulseFacade] })
export class PulseModule {}
