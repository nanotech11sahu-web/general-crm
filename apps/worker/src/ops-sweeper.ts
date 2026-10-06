import type { SystemOps, TenantDb } from '@leaddesk/db';
import { OpsService } from '@leaddesk/domain';

/** `ops.sweep` (every 5 min): evaluate each tenant's health rules and nudge admins (deduped per rule per hour). */
export class OpsSweeper {
  constructor(private readonly db: TenantDb, private readonly sys: SystemOps, private readonly now?: () => Date) {}
  run() { return OpsService.sweepAll(this.db, this.sys, this.now); }
}
