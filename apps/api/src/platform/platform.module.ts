import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Module, NotFoundException, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { BillingService, DomainError, OpsService, type PlanKey } from '@leaddesk/domain';
import { SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { runWithTenant, toObjectId, type SystemOps, type TenantDb } from '@leaddesk/db';
import { MembershipCache, Public } from '../common/guards';
import { EntitlementCache } from '../billing/billing.module';

const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/**
 * Operator (support) surface. Disabled unless PLATFORM_ADMIN_TOKEN (32+ chars) is set; optional IP allow-list; bearer compared in
 * constant time. It exposes workspace metadata and counts only: never lead contents, contacts, messages or credentials, and there is
 * deliberately no impersonation. Every action is written to the global platform audit.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const token = process.env.PLATFORM_ADMIN_TOKEN;
    if (!token || token.length < 32) throw new NotFoundException(); // not configured: the surface does not exist
    const req = ctx.switchToHttp().getRequest<Request>();
    const ips = (process.env.PLATFORM_ADMIN_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ips.length && !ips.includes(req.ip ?? '')) throw new NotFoundException();
    if (!eq(String(req.headers.authorization ?? ''), `Bearer ${token}`)) throw new UnauthorizedException();
    return true;
  }
}

class ReasonDto { @IsOptional() @IsString() @MaxLength(300) reason?: string }
class TrialDto { @IsInt() @Min(1) @Max(60) days!: number; @IsOptional() @IsString() @MaxLength(300) note?: string }
class SubDto { @IsIn(['trial', 'starter', 'growth', 'scale']) plan!: PlanKey; @IsInt() @Min(1) @Max(500) seats!: number; @IsOptional() @IsString() periodEnd?: string; @IsOptional() @IsString() @MaxLength(300) note?: string }

@Injectable()
export class PlatformFacade {
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(SYSTEM_OPS) readonly sys: SystemOps, readonly members: MembershipCache, readonly ents: EntitlementCache) {}
  async tenant(id: string) { if (!/^[a-f0-9]{24}$/.test(id)) throw new NotFoundException(); const t: any = await this.sys.operatorTenant(toObjectId(id)); if (!t) throw new NotFoundException(); return t; }
  audit(action: string, tenantId: string | undefined, req: Request, meta?: unknown) { return this.sys.operatorAudit({ action, tenantId: tenantId ? toObjectId(tenantId) : undefined, meta, ip: req.ip }); }
}

@Public()
@UseGuards(PlatformGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly f: PlatformFacade) {}

  @Get('summary')
  summary() { return this.f.sys.operatorSummary(); }

  @Get('tenants')
  async tenants(@Query('q') q?: string, @Query('status') status?: string) {
    const rows: any[] = await this.f.sys.operatorTenants({ text: q?.slice(0, 80), status: ['active', 'suspended', 'deleted'].includes(status ?? '') ? status : undefined });
    const subs: any[] = rows.length ? await this.f.sys.operatorSubscriptions(rows.map((t) => t._id)) : [];
    const by = new Map(subs.map((s) => [String(s.tenantId), s]));
    return rows.map((t) => { const s = by.get(String(t._id)); return { id: String(t._id), name: t.name, slug: t.slug, status: t.status, createdAt: t.createdAt, plan: s?.plan ?? t.plan, subscription: s ? { status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt ?? null, currentPeriodEnd: s.currentPeriodEnd ?? null, provider: s.provider ?? null } : null }; });
  }

  @Get('tenants/:id')
  async tenant(@Param('id') id: string) {
    const t = await this.f.tenant(id);
    return runWithTenant(id, async () => {
      const svc = new BillingService(this.f.db); const ops = new OpsService(this.f.db); const R = this.f.db.repos;
      const [ent, usage, health, members, leads, lastLogin] = await Promise.all([svc.entitlements(), svc.usage(), ops.tenantHealth(), R.memberships.count({ status: 'active' }), R.leads.count({ deletedAt: null }), R.audit.find({ action: 'auth.login' }, { sort: { at: -1 }, limit: 1 })]);
      return { id, name: t.name, slug: t.slug, status: t.status, createdAt: t.createdAt, timezone: t.timezone, preset: t.industryPreset, entitlements: ent, usage, counts: { members, leads, connections: health.connections.byStatus }, alerts: ops.alertsFrom(health), lastLoginAt: (lastLogin as any[])[0]?.at ?? null, deletion: t.settings?.deletion ?? null };
    });
  }

  @Post('tenants/:id/suspend') @HttpCode(200)
  async suspend(@Param('id') id: string, @Body() b: ReasonDto, @Req() req: Request) {
    await this.f.tenant(id); await this.f.sys.operatorSetTenantStatus(toObjectId(id), 'suspended'); this.f.members.clear(); this.f.ents.invalidate(id);
    await this.f.audit('tenant.suspended', id, req, { reason: b.reason }); return { ok: true, status: 'suspended' };
  }
  @Post('tenants/:id/unsuspend') @HttpCode(200)
  async unsuspend(@Param('id') id: string, @Body() b: ReasonDto, @Req() req: Request) {
    await this.f.tenant(id); await this.f.sys.operatorSetTenantStatus(toObjectId(id), 'active'); this.f.members.clear();
    await this.f.audit('tenant.unsuspended', id, req, { reason: b.reason }); return { ok: true, status: 'active' };
  }
  @Post('tenants/:id/extend-trial') @HttpCode(200)
  async extend(@Param('id') id: string, @Body() b: TrialDto, @Req() req: Request) {
    await this.f.tenant(id); const r = await runWithTenant(id, () => new BillingService(this.f.db).extendTrial(b.days)); this.f.ents.invalidate(id);
    await this.f.audit('trial.extended', id, req, { days: b.days, note: b.note }); return r;
  }
  /** For invoiced customers or goodwill: sets the plan directly (provider 'manual'); online payments are not touched. */
  @Post('tenants/:id/subscription') @HttpCode(200)
  async subscription(@Param('id') id: string, @Body() b: SubDto, @Req() req: Request) {
    await this.f.tenant(id);
    const end = b.periodEnd ? new Date(b.periodEnd) : null; if (end && Number.isNaN(end.getTime())) throw new DomainError('invalid_date', 'periodEnd must be an ISO date');
    const r = await runWithTenant(id, () => new BillingService(this.f.db).setManual({ plan: b.plan, seats: b.seats, periodEnd: end, note: b.note })); this.f.ents.invalidate(id);
    await this.f.audit('subscription.set_manual', id, req, { plan: b.plan, seats: b.seats, periodEnd: end, note: b.note }); return r;
  }
  @Get('audit')
  audit(@Query('tenantId') tenantId?: string) { return this.f.sys.operatorAuditList(tenantId && /^[a-f0-9]{24}$/.test(tenantId) ? toObjectId(tenantId) : undefined); }
}

@Module({ controllers: [PlatformController], providers: [PlatformFacade, PlatformGuard] })
export class PlatformModule {}
