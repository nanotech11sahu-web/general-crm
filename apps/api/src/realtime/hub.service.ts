import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { can, type Role } from '@leaddesk/shared';
import { runWithTenant, toObjectId, type TenantDb } from '@leaddesk/db';
import { TENANT_DB } from '@leaddesk/platform';

export interface RtEvent { id: string; type: string; data: Record<string, unknown> }
export interface RtClient { id: number; tenantId: string; userId: string; role: Role; send: (e: RtEvent) => void }

const oidAt = (ms: number) => toObjectId(Math.floor(ms / 1000).toString(16).padStart(8, '0') + '0000000000000000');
const MAX_CLIENTS_PER_USER = 5;

/**
 * Tenant- and user-scoped fan-out for SSE. Events come from the transactional outbox and the
 * notifications collection (so every API instance sees every event; no cross-instance state).
 * It only polls for tenants that currently have a connected client. Payloads carry ids and
 * reasons, never contact details.
 */
@Injectable()
export class RealtimeHub implements OnModuleDestroy {
  private readonly log = new Logger('Realtime');
  private readonly clients = new Map<number, RtClient>();
  private cursors = new Map<string, { ev: unknown; nt: unknown; task: number }>();
  private seq = 0;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}

  private get pollMs() { return Number(process.env.REALTIME_POLL_MS ?? 1000); }

  add(c: Omit<RtClient, 'id'>): { id: number } | null {
    const mine = [...this.clients.values()].filter((x) => x.userId === c.userId && x.tenantId === c.tenantId).length;
    if (mine >= MAX_CLIENTS_PER_USER) return null;
    const id = ++this.seq;
    this.clients.set(id, { ...c, id });
    if (!this.cursors.has(c.tenantId)) this.cursors.set(c.tenantId, { ev: oidAt(Date.now()), nt: oidAt(Date.now()), task: Date.now() });
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.pollMs);
    return { id };
  }

  remove(id: number) {
    this.clients.delete(id);
    const live = new Set([...this.clients.values()].map((c) => c.tenantId));
    for (const t of [...this.cursors.keys()]) if (!live.has(t)) this.cursors.delete(t);
    if (!this.clients.size && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  size() { return this.clients.size; }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); this.clients.clear(); }

  /** Which of this client's events does an outbox event produce? */
  private fromOutbox(e: any, c: RtClient): RtEvent | null {
    const p = e.payload ?? {};
    const mgr = can(c.role, 'leads.reassign');
    const mk = (type: string, data: Record<string, unknown>): RtEvent => ({ id: String(e._id), type, data });
    switch (e.type) {
      case 'lead.assigned':
        if (p.ownerId && String(p.ownerId) === c.userId) return mk('lead.assigned', { leadId: e.aggregateId, claimDueAt: p.claimDueAt ?? null, reason: p.reason });
        if (!p.ownerId && mgr) return mk('lead.unassigned', { leadId: e.aggregateId, reason: p.reason });
        return null;
      case 'task.created': return String(p.assigneeId) === c.userId ? mk('task.created', { taskId: e.aggregateId, leadId: p.leadId }) : null;
      case 'task.missed': return String(p.assigneeId) === c.userId || mgr ? mk('task.missed', { taskId: e.aggregateId, leadId: p.leadId }) : null;
      case 'call.ended': return String(p.agentId) === c.userId ? mk('call.ended', { callSessionId: e.aggregateId, leadId: p.leadId, durationS: p.durationS, outcome: p.outcome }) : null;
      case 'task.escalated': return mgr ? mk('task.escalated', { taskId: e.aggregateId }) : null;
      default: return null;
    }
  }

  private fromNotification(n: any, c: RtClient): RtEvent | null {
    const ok = n.audience === 'user' ? String(n.userId) === c.userId
      : n.audience === 'admins' ? can(c.role, 'connections.manage')
      : can(c.role, 'leads.reassign');
    return ok ? { id: `n:${n._id}`, type: n.kind, data: { notificationId: String(n._id), ...(n.payload ?? {}) } } : null;
  }

  /** Replay after a reconnect (Last-Event-ID), bounded to the last 10 minutes / 200 events. */
  async replay(c: RtClient, lastEventId: string): Promise<RtEvent[]> {
    const raw = lastEventId.replace(/^n:/, '');
    if (!/^[a-f0-9]{24}$/.test(raw)) return [];
    const since = toObjectId(raw);
    const floor = oidAt(Date.now() - 10 * 60_000);
    const from = since.toString() > floor.toString() ? since : floor;
    return runWithTenant(c.tenantId, async () => {
      const evs: any[] = await this.db.repos.outbox.find({ _id: { $gt: from } }, { sort: { _id: 1 }, limit: 200 });
      const nts: any[] = await this.db.repos.notifications.find({ _id: { $gt: from } }, { sort: { _id: 1 }, limit: 200 });
      return [...evs.map((e) => this.fromOutbox(e, c)), ...nts.map((n) => this.fromNotification(n, c))].filter((x): x is RtEvent => !!x);
    });
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const [tenantId, cur] of [...this.cursors.entries()]) {
        const cs = [...this.clients.values()].filter((c) => c.tenantId === tenantId);
        if (!cs.length) continue;
        await runWithTenant(tenantId, async () => {
          const evs: any[] = await this.db.repos.outbox.find({ _id: { $gt: cur.ev } }, { sort: { _id: 1 }, limit: 200 });
          const nts: any[] = await this.db.repos.notifications.find({ _id: { $gt: cur.nt } }, { sort: { _id: 1 }, limit: 200 });
          if (evs.length) cur.ev = evs[evs.length - 1]._id;
          if (nts.length) cur.nt = nts[nts.length - 1]._id;
          for (const e of evs) for (const c of cs) { const m = this.fromOutbox(e, c); if (m) c.send(m); }
          for (const n of nts) for (const c of cs) { const m = this.fromNotification(n, c); if (m) c.send(m); }
          // task.due: open tasks that became due since the last tick, for the connected assignees
          const now = Date.now();
          const due: any[] = await this.db.repos.tasks.find({ status: 'open', dueAt: { $gt: new Date(cur.task), $lte: new Date(now) }, assigneeId: { $in: cs.map((c) => toObjectId(c.userId)) } }, { limit: 200 });
          cur.task = now;
          for (const t of due) for (const c of cs) if (String(t.assigneeId) === c.userId) c.send({ id: `d:${t._id}:${new Date(t.dueAt).getTime()}`, type: 'task.due', data: { taskId: String(t._id), leadId: String(t.leadId), dueAt: t.dueAt } });
        }).catch((e) => this.log.warn(`tick failed for tenant ${tenantId}: ${e?.message}`));
      }
    } finally { this.ticking = false; }
  }
}
