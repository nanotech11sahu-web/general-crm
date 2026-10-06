import { Inject, Injectable } from '@nestjs/common';
import type { TenantDb } from '@leaddesk/db';
import { TENANT_DB } from '@leaddesk/platform';

@Injectable()
export class AuditService {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}
  record(e: { action: string; entity?: string; entityId?: string; meta?: unknown; ip?: string; ua?: string }) {
    return this.db.repos.audit.record(e);
  }
}
