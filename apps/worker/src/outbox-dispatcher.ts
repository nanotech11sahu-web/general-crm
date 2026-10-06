import type { SystemOps } from '@leaddesk/db';

export interface EventSink { publish(e: { tenantId: string; type: string; aggregateId?: string; payload: unknown; eventId: string }): Promise<void> }

/**
 * Polls the transactional outbox, leases events across tenants and hands them to
 * the queue with tenantId attached. At-least-once: an event is marked dispatched
 * only after publish succeeds; a crashed lease expires and is re-claimed.
 */
export class OutboxDispatcher {
  private timer?: NodeJS.Timeout;
  constructor(private readonly sys: SystemOps, private readonly sink: EventSink, private readonly batch = 100) {}

  async tick(): Promise<number> {
    const events = await this.sys.claimEvents(this.batch);
    let n = 0;
    for (const e of events) {
      try {
        await this.sink.publish({ tenantId: String(e.tenantId), type: e.type, aggregateId: e.aggregateId, payload: e.payload, eventId: String(e._id) });
        await this.sys.markDispatched(e._id);
        n++;
      } catch { /* lease expires; retried on a later tick */ }
    }
    return n;
  }
  start(intervalMs = 1000) {
    const loop = async () => { try { await this.tick(); } finally { this.timer = setTimeout(loop, intervalMs); } };
    void loop();
  }
  stop() { if (this.timer) clearTimeout(this.timer); }
}
