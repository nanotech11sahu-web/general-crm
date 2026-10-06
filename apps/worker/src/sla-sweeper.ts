import type { SystemOps, TenantDb } from '@leaddesk/db';
import { SlaService } from '@leaddesk/domain';

/** `sla.sweep` (every 30 s): reassign leads whose claim / first-contact timers expired. State lives on the lead, so this is idempotent. */
export class SlaSweeper {
  private readonly svc: SlaService;
  constructor(db: TenantDb, private readonly sys: SystemOps, now?: () => Date) { this.svc = new SlaService(db, now); }
  run() { return this.svc.sweepAll(this.sys); }
}
