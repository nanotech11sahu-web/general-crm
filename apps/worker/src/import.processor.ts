import { ImportService } from '@leaddesk/domain';
import type { TenantDb } from '@leaddesk/db';
import { TenantProcessor, TenantJob } from './tenant-processor';

export interface ImportJob { tenantId: string; importId: string }

/** `import.run`: same chunked, resumable ImportService the API uses. */
export class ImportProcessor extends TenantProcessor<ImportJob, unknown> {
  private readonly svc: ImportService;
  constructor(db: TenantDb) { super(); this.svc = new ImportService(db); }
  protected async handle(job: TenantJob<ImportJob>) {
    if (!(await this.svc.claim(job.data.importId))) return { skipped: true }; // already running/done: idempotent redelivery
    return this.svc.run(job.data.importId);
  }
}
