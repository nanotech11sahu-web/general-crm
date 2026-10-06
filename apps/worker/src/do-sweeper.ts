import type { SystemOps, TenantDb } from '@leaddesk/db';
import { DoService } from '@leaddesk/domain';

/** `do.sweep` (every minute): mark overdue tasks missed (after grace), notify, and escalate stale ones. */
export class DoSweeper {
  private readonly svc: DoService;
  constructor(db: TenantDb, private readonly sys: SystemOps, now?: () => Date) { this.svc = new DoService(db, now); }
  run() { return this.svc.sweepAll(this.sys); }
}
