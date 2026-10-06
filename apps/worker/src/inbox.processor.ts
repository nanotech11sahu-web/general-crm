import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { InboxService } from '@leaddesk/domain';
import type { TenantDb } from '@leaddesk/db';
import { TenantProcessor, TenantJob } from './tenant-processor';

export interface InboxJob { tenantId: string; inboxId: string }

/** `inbox.process`: thin queue wrapper over the shared InboxService (same code path as API replay). */
export class InboxProcessor extends TenantProcessor<InboxJob, { events: number }> {
  private readonly svc: InboxService;
  constructor(db: TenantDb, registry: ConnectorRegistry, keys?: KeyService, maxAttempts = 8) { super(); this.svc = new InboxService(db, registry, maxAttempts, keys); }

  protected async handle(job: TenantJob<InboxJob>) {
    const out = await this.svc.process(job.data.inboxId); // throws only for retryable failures
    return { events: out.leads.length };
  }
}
