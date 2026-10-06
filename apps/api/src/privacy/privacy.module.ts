import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, Module, Param, Post, Put, Res, UnauthorizedException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { PrivacyService, RetentionService, TenantDataService, type ObjectStore } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { runWithTenant, type TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { DoModule, OBJECT_STORE } from '../do/do.module';

class EraseDto { @IsOptional() @IsString() @MaxLength(200) reason?: string }
class PasswordDto { @IsString() @MaxLength(128) password!: string }
class RetentionDto { @IsOptional() @IsInt() @Min(7) @Max(3650) recordingDays?: number; @IsOptional() @IsInt() @Min(1) @Max(365) softDeletedLeadDays?: number }

@Injectable()
export class PrivacyFacade {
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(OBJECT_STORE) readonly store: ObjectStore, readonly audit: AuditService) {}
  privacy() { return new PrivacyService(this.db, this.store); }
  data() { return new TenantDataService(this.db); }
  retention() { return new RetentionService(this.db, this.store); }
  async reauth(u: AuthUser, password: string) {
    const user: any = await this.db.models.User.findById(u.userId).lean().exec();
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) throw new UnauthorizedException('Password is wrong');
  }
}

/** DPDP / GDPR tooling: subject access, erasure, workspace export, retention and deletion. All of it is audited. */
@Controller('v1')
export class PrivacyController {
  constructor(private readonly f: PrivacyFacade) {}

  @Get('leads/:id/export') @RequirePermission('leads.export') @Header('Cache-Control', 'no-store')
  async exportLead(@Param('id') id: string) { const x = await this.f.privacy().exportLead(id); await this.f.audit.record({ action: 'privacy.lead_exported', entity: 'lead', entityId: id }); return x; }

  @Delete('leads/:id/erase') @HttpCode(200) @RequirePermission('tenant.manage')
  erase(@Param('id') id: string, @Body() b: EraseDto) { return this.f.privacy().eraseLead(id, { reason: b.reason }); }

  /** Owner only. Streams NDJSON; credentials, sessions and raw webhook copies are never included. */
  @Get('tenant/export') @RequirePermission('billing.manage')
  async exportTenant(@CurrentUser() u: AuthUser, @Res() res: Response) {
    await this.f.audit.record({ action: 'tenant.exported', entity: 'tenant', entityId: u.tenantId });
    res.setHeader('content-type', 'application/x-ndjson; charset=utf-8'); res.setHeader('content-disposition', 'attachment; filename="leaddesk-export.ndjson"'); res.setHeader('cache-control', 'no-store');
    await runWithTenant(u.tenantId, async () => { for await (const line of this.f.data().exportLines()) if (!res.write(line + '\n')) await new Promise((r) => res.once('drain', r)); }, { userId: u.userId }); // streaming runs after the handler returns: keep the tenant context explicit
    res.end();
  }

  @Get('tenant/deletion') @RequirePermission('tenant.delete')
  deletion() { return this.f.data().deletionStatus().then((d) => d ?? { scheduled: false }); }
  @Post('tenant/deletion') @HttpCode(200) @RequirePermission('tenant.delete')
  async requestDeletion(@CurrentUser() u: AuthUser, @Body() b: PasswordDto) { await this.f.reauth(u, b.password); return this.f.data().requestDeletion(u.userId); }
  @Delete('tenant/deletion') @HttpCode(200) @RequirePermission('tenant.delete')
  cancelDeletion() { return this.f.data().cancelDeletion(); }

  @Get('settings/retention') @RequirePermission('tenant.manage')
  retention() { return this.f.retention().settings(); }
  @Put('settings/retention') @RequirePermission('tenant.manage')
  async setRetention(@Body() b: RetentionDto) { const s = await this.f.retention().updateSettings(b); await this.f.audit.record({ action: 'retention.updated', entity: 'tenant', meta: b as any }); return s; }
}

@Module({ imports: [DoModule], controllers: [PrivacyController], providers: [PrivacyFacade] })
export class PrivacyModule {}
