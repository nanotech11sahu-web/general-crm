import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import type { SystemOps, TenantDb } from '@leaddesk/db';
import { AiService, AutopilotService, type ObjectStore } from '@leaddesk/domain';

/** `ai.assess` (every minute): examine new leads for tenants with AI on, then let the (opt-in) qualification assistant answer waiting chats. Intake never waits for this; a cap/429 just ends the pass. */
export class AiSweeper {
  constructor(private readonly db: TenantDb, private readonly sys: SystemOps, private readonly keys: KeyService, private readonly registry: ConnectorRegistry, private readonly store?: ObjectStore, private readonly now?: () => Date) {}
  async run() {
    const r = await AiService.sweepAll(this.db, this.keys, this.registry, this.sys, { now: this.now, store: this.store });
    await AutopilotService.sweepAll(this.db, this.keys, this.registry, this.sys, { now: this.now });
    return r;
  }
}
