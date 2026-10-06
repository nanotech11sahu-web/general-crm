import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import type { SystemOps, TenantDb } from '@leaddesk/db';
import { CadenceService } from '@leaddesk/domain';

/** `cadence.sweep` (every 30 s): run cadence / first-touch steps that are due. State is on the enrollment, so reruns are safe. */
export class CadenceSweeper {
  private readonly svc: CadenceService;
  constructor(db: TenantDb, private readonly sys: SystemOps, keys: KeyService, registry: ConnectorRegistry, now?: () => Date) { this.svc = new CadenceService(db, keys, registry, now); }
  run() { return this.svc.sweepAll(this.sys); }
}
