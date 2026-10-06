import { Body, CanActivate, Controller, ExecutionContext, Get, Global, Inject, Injectable, Module, Param, Post, Put, Query, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { BillingService, DomainError, paymentProviderFromEnv, publicPlans, type Entitlements, type PaymentProvider } from '@leaddesk/domain';
import { SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';
import type { FetchLike } from '@leaddesk/connectors-core';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Public, RequirePermission } from '../common/guards';
import { HTTP_FETCH } from '../connections/connections.module';
import { ConnectionsModule } from '../connections/connections.module';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const ALLOW_RESTRICTED = 'allow_restricted';
/** Routes that must keep working when the workspace is read-only (billing itself, account security, legal data rights). */
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED, true);

/** Entitlements per workspace, cached briefly; billing changes on this instance invalidate it immediately. */
@Injectable()
export class EntitlementCache {
  private readonly m = new Map<string, { e: Entitlements; exp: number }>();
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}
  invalidate(tenantId: string) { this.m.delete(tenantId); }
  async get(tenantId: string): Promise<Entitlements> {
    const hit = this.m.get(tenantId); if (hit && hit.exp > Date.now()) return hit.e;
    const e = await runWithTenant(tenantId, () => new BillingService(this.db).entitlements());
    this.m.set(tenantId, { e, exp: Date.now() + 10_000 }); return e;
  }
}

/**
 * Expired / past-grace workspaces become read-only: reads, exports and billing keep working, every write answers 402
 * `subscription_required`. Webhook intake is a separate service and keeps accepting leads, so nothing is lost while a customer decides.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly cache: EntitlementCache) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest(); const user: AuthUser | undefined = req.user;
    if (!user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED, [ctx.getHandler(), ctx.getClass()])) return true;
    const e = await this.cache.get(user.tenantId);
    if (e.restricted) throw new DomainError('subscription_required', e.reason ?? 'This workspace is read-only until the subscription is active', { status: e.status }, 402);
    return true;
  }
}

class CheckoutDto { @IsIn(['starter', 'growth', 'scale']) plan!: string; @IsInt() @Min(1) @Max(500) seats!: number }
class PlanChangeDto { @IsIn(['starter', 'growth', 'scale']) plan!: string; @IsOptional() @IsInt() @Min(1) @Max(500) seats?: number }
class BillingProfileDto {
  @IsOptional() @IsString() @MaxLength(120) legalName?: string;
  @IsOptional() @IsString() @MaxLength(20) gstin?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,2}$/) stateCode?: string;
  @IsOptional() @IsString() @MaxLength(10) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
}
class SeatsDto { @IsInt() @Min(1) @Max(500) seats!: number }

@Injectable()
export class BillingFacade {
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(SYSTEM_OPS) readonly sys: SystemOps, @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider | undefined, readonly cache: EntitlementCache) {}
  svc() { return new BillingService(this.db, undefined, this.provider, undefined, this.sys); }
}

@Controller('v1')
export class PlansController {
  /** Public: the pricing table on the landing page. */
  @Public() @Get('plans') plans() { return { currency: 'INR', unit: 'per seat per month', plans: publicPlans() }; }
}

@AllowRestricted()
@Controller('v1/billing')
export class BillingController {
  constructor(private readonly f: BillingFacade) {}
  /** Everyone signed in: drives the trial / read-only banner. Nothing sensitive. */
  @Get('status')
  async status(@CurrentUser() u: AuthUser) {
    // the same (briefly cached) view the write guard uses, so a banner never appears before writes are actually refused
    const e = await this.f.cache.get(u.tenantId);
    return { status: e.status, plan: e.plan, planName: e.planName, trialDaysLeft: e.trialDaysLeft, restricted: e.restricted, reason: e.reason, cancelAtPeriodEnd: e.cancelAtPeriodEnd, currentPeriodEnd: e.currentPeriodEnd };
  }
  @Get() @RequirePermission('tenant.manage')
  overview() { return this.f.svc().overview(); }
  @Get('usage') @RequirePermission('tenant.manage')
  usage() { return this.f.svc().usage(); }
  /** Owner only: starts a hosted checkout; the plan changes only when the provider confirms payment by signed webhook. */
  @Post('checkout') @RequirePermission('billing.manage')
  async checkout(@CurrentUser() u: AuthUser, @Body() b: CheckoutDto) {
    const email = ((await this.f.db.models.User.findById(u.userId, { email: 1 }).lean().exec()) as any)?.email ?? '';
    const r = await this.f.svc().checkout({ plan: b.plan, seats: b.seats, email }); this.f.cache.invalidate(u.tenantId); return r;
  }
  @Get('profile') @RequirePermission('tenant.manage')
  profile() { return this.f.svc().profile(); }
  @Put('profile') @RequirePermission('billing.manage')
  setProfile(@Body() b: BillingProfileDto) { return this.f.svc().setProfile(b); }
  @Get('invoices') @RequirePermission('tenant.manage')
  invoices() { return this.f.svc().invoices(); }
  @Get('invoices/:id') @RequirePermission('tenant.manage')
  invoice(@Param('id') id: string) { return this.f.svc().invoice(id); }
  @Get('quote') @RequirePermission('billing.manage')
  quote(@Query('plan') plan?: string, @Query('seats') seats?: string) { return this.f.svc().quote({ plan, seats: seats ? Number(seats) : undefined }); }
  @Post('plan') @RequirePermission('billing.manage')
  async plan(@CurrentUser() u: AuthUser, @Body() b: PlanChangeDto) { const r = await this.f.svc().changePlan(b); this.f.cache.invalidate(u.tenantId); return r; }
  @Post('seats') @RequirePermission('billing.manage')
  async seats(@CurrentUser() u: AuthUser, @Body() b: SeatsDto) { const r = await this.f.svc().changeSeats(b.seats); this.f.cache.invalidate(u.tenantId); return r; }
  @Post('cancel') @RequirePermission('billing.manage')
  async cancel(@CurrentUser() u: AuthUser) { const r = await this.f.svc().cancel(); this.f.cache.invalidate(u.tenantId); return r; }
}

@Global()
@Module({
  imports: [ConnectionsModule],
  controllers: [PlansController, BillingController],
  providers: [
    { provide: PAYMENT_PROVIDER, inject: [HTTP_FETCH], useFactory: (f: FetchLike | undefined) => paymentProviderFromEnv(process.env, f) },
    EntitlementCache, SubscriptionGuard, BillingFacade,
  ],
  exports: [EntitlementCache, SubscriptionGuard, PAYMENT_PROVIDER],
})
export class BillingModule {}
