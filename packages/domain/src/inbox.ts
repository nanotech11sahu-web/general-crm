import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import type { TenantDb } from '@leaddesk/db';
import { DomainError, notFound } from './errors';
import { leadFromFields } from './field-map';
import { ConnectionService } from './connections';
import { LeadService } from './lead-service';

export type InboxOutcome = { status: 'done' | 'failed' | 'dead'; leads: { outcome: string; leadId?: string }[]; error?: string };

/**
 * `inbox.process`: stored raw event -> canonical events -> the single lead intake pipeline.
 * Non-retryable problems (bad mapping, rejected lead) end as `failed` and show up in "Needs
 * attention" for fix-mapping-and-replay. Infrastructure errors throw so the queue retries.
 */
export class InboxService {
  private readonly leads: LeadService;
  private readonly conns?: ConnectionService;
  /** `keys` lets providers that only send an id (Meta) fetch the full record with decrypted credentials. */
  constructor(private readonly db: TenantDb, private readonly registry: ConnectorRegistry, private readonly maxAttempts = 8, keys?: KeyService) {
    this.leads = new LeadService(db);
    if (keys) this.conns = new ConnectionService(db, keys, registry);
  }
  private get r() { return this.db.repos; }

  async process(inboxId: string): Promise<InboxOutcome> {
    const row: any = await this.r.inbox.findOne({ _id: inboxId });
    if (!row) throw notFound('Inbox event');
    if (row.status === 'done') return { status: 'done', leads: [] }; // idempotent redelivery
    const attempts = (row.attempts ?? 0) + 1;
    await this.r.inbox.updateOne({ _id: row._id }, { $set: { status: 'processing' }, $inc: { attempts: 1 } });
    const conn: any = await this.r.connections.findById(row.connectionId);
    try {
      if (!conn) throw new DomainError('rejected', 'Connection no longer exists');
      const connector = this.registry.get(row.provider);
      if (!connector?.parseWebhook) throw new DomainError('rejected', `No webhook parser for ${row.provider}`);
      const events = await connector.parseWebhook(row.rawPayload, this.conns?.contextFor(conn));
      const defs: any[] = await this.r.customFields.find();
      const mapping = parseMapping(conn.config?.fieldMapping);
      const results: InboxOutcome['leads'] = [];
      for (const e of events) {
        if (e.kind !== 'LeadReceived') continue; // calls/messages are handled by their own pipelines in later phases
        const input = leadFromFields(e.fields, defs, mapping);
        input.source = { kind: row.provider, name: conn.name };
        if (e.externalRef) input.externalRef = e.externalRef;
        const out = await this.leads.intake(input);
        if (out.outcome === 'rejected') throw new DomainError('rejected', `Lead rejected: ${out.reason}`, out.invalid);
        results.push({ outcome: out.outcome, leadId: out.leadId });
      }
      await this.r.inbox.updateOne({ _id: row._id }, { $set: { status: 'done', processedAt: new Date(), error: null } });
      if (results.some((x) => x.outcome === 'created' || x.outcome === 'merged')) await this.r.connections.updateOne({ _id: conn._id }, { $set: { lastEventAt: new Date() } });
      return { status: 'done', leads: results };
    } catch (e: any) {
      const retryable = !(e instanceof DomainError && e.code === 'rejected');
      const status = retryable && attempts >= this.maxAttempts ? 'dead' : 'failed';
      const msg = String(e?.message ?? e).slice(0, 500);
      await this.r.inbox.updateOne({ _id: row._id }, { $set: { status, error: msg } });
      if (conn) await this.r.integrationLogs.create({ connectionId: conn._id, level: 'error', message: `Inbox ${row._id} ${status}: ${msg}`.slice(0, 500), at: new Date() });
      if (retryable) throw e; // let the queue back off and retry
      return { status: 'failed', leads: [], error: String(e?.message ?? e) };
    }
  }

  /** "Needs attention": failed and dead events. */
  needsAttention(limit = 50) {
    return this.r.inbox.find({ status: { $in: ['failed', 'dead'] } }, { sort: { receivedAt: -1 }, limit: Math.min(limit, 200), projection: { rawPayload: 1, status: 1, error: 1, attempts: 1, receivedAt: 1, connectionId: 1, provider: 1, externalEventId: 1 } });
  }

  /** Replay after fixing the mapping: resets state and re-runs through the same path. */
  async replay(inboxId: string): Promise<InboxOutcome> {
    const row: any = await this.r.inbox.findById(inboxId);
    if (!row) throw notFound('Inbox event');
    if (row.status === 'processing') throw new DomainError('invalid_state', 'Event is being processed', undefined, 409);
    await this.r.inbox.updateOne({ _id: row._id }, { $set: { status: 'received', attempts: 0, error: null } });
    return this.process(inboxId);
  }

  /** Synthetic end-to-end probe used by the "Send test lead" button. */
  async testLead(connectionId: string, fields: Record<string, unknown>) {
    const externalEventId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conn: any = await this.r.connections.findById(connectionId);
    if (!conn) throw notFound('Connection');
    const row: any = await this.r.inbox.create({ connectionId: conn._id, provider: conn.provider, eventType: 'test', externalEventId, rawPayload: fields, signatureValid: true, status: 'received', receivedAt: new Date() });
    const out = await this.process(String(row._id));
    return out;
  }
}

function parseMapping(raw: unknown): Record<string, string> | undefined {
  if (!raw) return undefined;
  try { const m = typeof raw === 'string' ? JSON.parse(raw) : raw; return m && typeof m === 'object' ? (m as Record<string, string>) : undefined; } catch { return undefined; }
}
