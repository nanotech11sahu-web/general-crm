import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import type { SystemOps, TenantDb } from '@leaddesk/db';
import { AiService, PulseService } from '@leaddesk/domain';

/** `pulse.sweep` (hourly): once a tenant's local digest hour has passed, roll up yesterday and send the digest (deduped per day). The AI-written summary is optional and never delays it. */
export class PulseSweeper {
  constructor(private readonly db: TenantDb, private readonly sys: SystemOps, private readonly keys?: KeyService, private readonly registry?: ConnectorRegistry, private readonly now?: () => Date) {}
  run() {
    const insight = this.keys && this.registry ? (i: Parameters<AiService['digestInsight']>[0]) => new AiService(this.db, this.keys!, this.registry!, { now: this.now }).digestInsight(i) : undefined;
    return PulseService.sweepAll(this.db, this.sys, this.now, insight);
  }
}
