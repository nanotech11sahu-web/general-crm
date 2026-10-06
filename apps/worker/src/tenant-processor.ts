import { runTenantJob } from '@leaddesk/db';

export interface TenantJob<D extends { tenantId: string }> { name: string; data: D; attemptsMade: number; opts?: { attempts?: number } }

/**
 * Base for every BullMQ processor. A job without tenantId is rejected; otherwise
 * the handler runs inside that tenant's AsyncLocalStorage scope (spec §6.5).
 */
export abstract class TenantProcessor<D extends { tenantId: string }, R = void> {
  protected abstract handle(job: TenantJob<D>): Promise<R>;
  process(job: TenantJob<D>): Promise<R> {
    return runTenantJob(job.data, () => this.handle(job));
  }
}
