import { BadRequestException, Body, Controller, Get, Inject, Injectable, Logger, Module, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { DomainError, ImportService, MAX_BYTES } from '@leaddesk/domain';
import { TENANT_DB } from '@leaddesk/platform';
import { runWithTenant, type TenantDb } from '@leaddesk/db';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { AuditService } from '../audit/audit.service';

class MappingDto {
  @IsObject() mapping!: Record<string, string>;
  @IsOptional() @IsIn(['skip', 'merge', 'overwrite']) dedupePolicy?: 'skip' | 'merge' | 'overwrite';
  @IsOptional() @IsString() @MaxLength(80) saveAs?: string;
}
class RunDto { @IsOptional() @IsIn(['skip', 'merge', 'overwrite']) dedupePolicy?: 'skip' | 'merge' | 'overwrite' }

@Injectable()
export class ImportsFacade {
  readonly svc: ImportService;
  private readonly log = new Logger('Import');
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, readonly audit: AuditService) { this.svc = new ImportService(db); }

  /**
   * Phase 1 runs the chunked job in-process after the request returns. The job is resumable
   * (per-row outcomes + stale-heartbeat reclaim), and the same ImportService runs inside the
   * worker app, so moving dispatch onto BullMQ later changes no behaviour.
   */
  start(tenantId: string, userId: string, id: string) {
    setImmediate(() => {
      runWithTenant(tenantId, () => this.svc.run(id), { userId }).catch((e) => this.log.error(`import ${id} failed: ${e?.message}`));
    });
  }
}

@Controller('v1')
export class ImportsController {
  constructor(private readonly f: ImportsFacade) {}

  @Post('imports') @RequirePermission('imports.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1 } }))
  async upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    if (!file) throw new BadRequestException('Attach a .csv or .xlsx file as the "file" field');
    const out = await this.f.svc.create(file, u.userId);
    await this.f.audit.record({ action: 'import.uploaded', entity: 'import', entityId: out.id, meta: { filename: file.originalname, rows: out.rowCount } });
    return out;
  }

  @Get('imports/:id') @RequirePermission('imports.manage')
  get(@Param('id') id: string) { return this.f.svc.get(id); }

  @Put('imports/:id/mapping') @RequirePermission('imports.manage')
  mapping(@Param('id') id: string, @Body() b: MappingDto) { return this.f.svc.setMapping(id, b.mapping, { dedupePolicy: b.dedupePolicy, saveAs: b.saveAs }); }

  @Post('imports/:id/dry-run') @RequirePermission('imports.manage')
  dryRun(@Param('id') id: string) { return this.f.svc.dryRun(id); }

  @Post('imports/:id/run') @RequirePermission('imports.manage')
  async run(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: RunDto) {
    if (b.dedupePolicy) await this.f.db.repos.importJobs.updateOne({ _id: id, status: { $ne: 'running' } }, { $set: { dedupePolicy: b.dedupePolicy } });
    if (!(await this.f.svc.claim(id))) throw new DomainError('not_runnable', 'Import needs a mapping and must not already be running', undefined, 409);
    await this.f.audit.record({ action: 'import.started', entity: 'import', entityId: id });
    this.f.start(u.tenantId, u.userId, id);
    return { id, status: 'running' };
  }

  @Get('imports/:id/errors') @RequirePermission('imports.manage')
  async errors(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.f.svc.errorCsv(id);
    await this.f.audit.record({ action: 'import.errors_downloaded', entity: 'import', entityId: id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="import-errors.csv"');
    res.send(csv);
  }

  @Get('import-mappings') @RequirePermission('imports.manage')
  mappings() { return this.f.svc.savedMappings(); }
}

@Module({ controllers: [ImportsController], providers: [ImportsFacade] })
export class ImportsModule {}
