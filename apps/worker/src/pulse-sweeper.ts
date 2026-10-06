import type { SystemOps, TenantDb } from '@leaddesk/db';
import { PulseService } from '@leaddesk/domain';

/** `pulse.sweep` (hourly): once a tenant's local digest hour has passed, roll up yesterday and send the digest (deduped per day). */
export class PulseSweeper {
  constructor(private readonly db: TenantDb, private readonly sys: SystemOps, private readonly now?: () => Date) {}
  run() { return PulseService.sweepAll(this.db, this.sys, this.now); }
}
