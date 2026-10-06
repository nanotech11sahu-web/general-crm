import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import type { SystemOps, TenantDb } from '@leaddesk/db';
import { IntegrityService, planSweep, type SweepJob, type SweepKind } from '@leaddesk/domain';
import { TenantProcessor, TenantJob } from './tenant-processor';

export interface IntegrityJob { tenantId: string; connectionId: string; days?: number }

/** `integrity.heartbeat` and `integrity.backfill` share one processor; the job name selects the action. */
export class IntegrityProcessor extends TenantProcessor<IntegrityJob, unknown> {
  private readonly svc: IntegrityService;
  constructor(db: TenantDb, keys: KeyService, registry: ConnectorRegistry) { super(); this.svc = new IntegrityService(db, keys, registry); }
  protected handle(job: TenantJob<IntegrityJob>) {
    return job.name === 'integrity.backfill'
      ? this.svc.backfill(job.data.connectionId, job.data.days ?? 2)
      : this.svc.heartbeat(job.data.connectionId);
  }
}

/**
 * Lists live connections across tenants (a named system operation) and enqueues one
 * deterministic job per connection per window, so overlapping schedulers never double-run.
 */
export class IntegrityScheduler {
  constructor(private readonly sys: SystemOps, private readonly enqueue: (job: SweepJob) => Promise<void>, private readonly now: () => Date = () => new Date()) {}
  async sweep(kind: SweepKind): Promise<number> {
    const conns = await this.sys.listConnectionsForScheduler();
    const jobs = planSweep(kind, conns as any[], this.now());
    for (const j of jobs) await this.enqueue(j);
    return jobs.length;
  }
}
