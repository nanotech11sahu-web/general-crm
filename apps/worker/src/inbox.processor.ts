import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { TenantDb } from '@leaddesk/db';
import { TenantProcessor, TenantJob } from './tenant-processor';

export interface InboxJob { tenantId: string; inboxId: string }

/**
 * `inbox.process`: load row -> connector.parseWebhook -> canonical events.
 * Phase 0 stops after parsing and marks the row done; lead intake is wired in Phase 1.
 */
export class InboxProcessor extends TenantProcessor<InboxJob, { events: number }> {
  constructor(private readonly db: TenantDb, private readonly registry: ConnectorRegistry, private readonly maxAttempts = 8) { super(); }

  protected async handle(job: TenantJob<InboxJob>) {
    const { inbox } = this.db.repos;
    const row: any = await inbox.findOne({ _id: job.data.inboxId });
    if (!row) throw new Error('inbox row not found'); // another tenant's id looks exactly like this
    if (row.status === 'done') return { events: 0 }; // idempotent re-delivery
    await inbox.updateOne({ _id: row._id }, { $set: { status: 'processing' }, $inc: { attempts: 1 } });
    try {
      const connector = this.registry.get(row.provider);
      if (!connector?.parseWebhook) throw new Error(`No webhook parser for ${row.provider}`);
      const events = await connector.parseWebhook(row.rawPayload);
      await inbox.updateOne({ _id: row._id }, { $set: { status: 'done', processedAt: new Date(), error: null } });
      return { events: events.length };
    } catch (e: any) {
      const attempts = (row.attempts ?? 0) + 1;
      const dead = attempts >= this.maxAttempts;
      await inbox.updateOne({ _id: row._id }, { $set: { status: dead ? 'dead' : 'failed', error: String(e?.message ?? e).slice(0, 500) } });
      throw e; // BullMQ retries with backoff
    }
  }
}
