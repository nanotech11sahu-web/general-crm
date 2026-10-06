import type { SystemOps, TenantDb } from '@leaddesk/db';
import { runWithTenant } from '@leaddesk/db';
import { DbNotifier, type Notifier } from './integrity';

const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
export interface Thresholds { ingestLagS: number; sendFailureRate: number; sendFailureMin: number; slaLagS: number; outboxLagS: number }
export const DEFAULT_THRESHOLDS: Thresholds = { ingestLagS: 300, sendFailureRate: 0.2, sendFailureMin: 10, slaLagS: 120, outboxLagS: 300 };

export type Alert = { rule: 'ingest_lag' | 'dlq' | 'send_failures' | 'sla_timer_lag' | 'outbox_backlog' | 'connection_unhealthy'; severity: 'warning' | 'critical'; text: string; value: number };

/** Per-tenant operational health: the "is my pipeline healthy?" view, and the rules that raise alerts from it. */
export class OpsService {
  constructor(private readonly db: TenantDb, private readonly now: () => Date = () => new Date(), private readonly notifier: Notifier = new DbNotifier(db), private readonly th: Thresholds = DEFAULT_THRESHOLDS) {}
  private get r() { return this.db.repos; }
  private age(d: any) { return d ? Math.max(0, Math.round((this.now().getTime() - new Date(d).getTime()) / 1000)) : 0; }

  async tenantHealth() {
    const now = this.now(); const day = new Date(now.getTime() - 24 * 3600_000);
    const conns: any[] = await this.r.connections.find({});
    const byStatus: Record<string, number> = {};
    for (const c of conns) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const pending = { status: { $in: ['received', 'processing', 'failed'] } };
    const [oldest, pendingN, failedN, deadN, deadDay] = await Promise.all([
      this.r.inbox.find(pending, { sort: { receivedAt: 1 }, limit: 1, projection: { receivedAt: 1 } }), this.r.inbox.count(pending), this.r.inbox.count({ status: 'failed' }), this.r.inbox.count({ status: 'dead' }), this.r.inbox.count({ status: 'dead', receivedAt: { $gte: day } }),
    ]);
    const done: any[] = await this.r.inbox.find({ status: 'done', processedAt: { $ne: null } }, { sort: { receivedAt: -1 }, limit: 200, projection: { receivedAt: 1, processedAt: 1 } });
    const lat = done.map((e) => (new Date(e.processedAt).getTime() - new Date(e.receivedAt).getTime()) / 1000).filter((x) => x >= 0);
    const [sent, failed] = await Promise.all([this.r.messages.count({ direction: 'out', createdAt: { $gte: day } }), this.r.messages.count({ direction: 'out', status: 'failed', createdAt: { $gte: day } })]);
    const claimLate: any[] = await this.r.leads.find({ 'sla.state': 'awaiting_claim', 'sla.claimDueAt': { $lt: new Date(now.getTime() - this.th.slaLagS * 1000) }, deletedAt: null }, { sort: { 'sla.claimDueAt': 1 }, limit: 1, projection: { sla: 1 } });
    const claimLateN = await this.r.leads.count({ 'sla.state': 'awaiting_claim', 'sla.claimDueAt': { $lt: new Date(now.getTime() - this.th.slaLagS * 1000) }, deletedAt: null });
    const tasksUnswept = await this.r.tasks.count({ status: 'open', dueAt: { $lt: new Date(now.getTime() - 20 * 60_000) } });
    const outN = await this.r.outbox.count({ dispatchedAt: null }); const outOld: any[] = await this.r.outbox.find({ dispatchedAt: null }, { sort: { _id: 1 }, limit: 1, projection: { createdAt: 1 } });
    return {
      connections: { total: conns.length, byStatus, unhealthy: conns.filter((c) => ['degraded', 'failing', 'revoked'].includes(c.status)).map((c) => ({ id: String(c._id), name: c.name, provider: c.provider, status: c.status, lastEventAt: c.lastEventAt ?? null, lastError: c.lastError ? String(c.lastError).slice(0, 200) : null })) },
      webhooks: { pending: pendingN, failed: failedN, dead: deadN, deadLast24h: deadDay, oldestPendingS: this.age((oldest as any[])[0]?.receivedAt), processingLatencyS: { p50: pct(lat, 50), p95: pct(lat, 95), samples: lat.length } },
      sends: { last24h: sent, failed, failureRate: sent ? Math.round((failed / sent) * 1000) / 1000 : 0 },
      timers: { claimTimersOverdue: claimLateN, oldestClaimLagS: claimLate[0] ? this.age(claimLate[0].sla.claimDueAt) : 0, tasksNotSwept: tasksUnswept },
      outbox: { backlog: outN, oldestS: this.age(outOld[0]?.createdAt) },
      checkedAt: now,
    };
  }

  alertsFrom(h: Awaited<ReturnType<OpsService['tenantHealth']>>): Alert[] {
    const a: Alert[] = []; const t = this.th;
    if (h.webhooks.oldestPendingS > t.ingestLagS) a.push({ rule: 'ingest_lag', severity: h.webhooks.oldestPendingS > t.ingestLagS * 4 ? 'critical' : 'warning', text: `Incoming events have been waiting ${Math.round(h.webhooks.oldestPendingS / 60)} min to be processed`, value: h.webhooks.oldestPendingS });
    if (h.webhooks.deadLast24h > 0) a.push({ rule: 'dlq', severity: 'warning', text: `${h.webhooks.deadLast24h} incoming event${h.webhooks.deadLast24h === 1 ? '' : 's'} failed permanently in the last 24 h (see Connections -> failed events)`, value: h.webhooks.deadLast24h });
    if (h.sends.last24h >= t.sendFailureMin && h.sends.failureRate >= t.sendFailureRate) a.push({ rule: 'send_failures', severity: 'warning', text: `${Math.round(h.sends.failureRate * 100)}% of messages failed in the last 24 h`, value: h.sends.failureRate });
    if (h.timers.claimTimersOverdue > 0 || h.timers.tasksNotSwept > 0) a.push({ rule: 'sla_timer_lag', severity: 'critical', text: `Timers are running late: ${h.timers.claimTimersOverdue} claim window${h.timers.claimTimersOverdue === 1 ? '' : 's'} and ${h.timers.tasksNotSwept} task${h.timers.tasksNotSwept === 1 ? '' : 's'} not processed. The background worker may be down.`, value: h.timers.claimTimersOverdue + h.timers.tasksNotSwept });
    if (h.outbox.oldestS > t.outboxLagS) a.push({ rule: 'outbox_backlog', severity: 'warning', text: `Internal events are backed up (${h.outbox.backlog} waiting)`, value: h.outbox.oldestS });
    if (h.connections.unhealthy.length) a.push({ rule: 'connection_unhealthy', severity: h.connections.unhealthy.some((c) => c.status !== 'degraded') ? 'critical' : 'warning', text: `${h.connections.unhealthy.length} connection${h.connections.unhealthy.length === 1 ? ' needs' : 's need'} attention: ${h.connections.unhealthy.map((c) => c.name).slice(0, 3).join(', ')}`, value: h.connections.unhealthy.length });
    return a;
  }

  /** Notifies admins once per rule per hour (dedupe key), so a long incident is one nudge an hour, not a flood. */
  async evaluate(): Promise<Alert[]> {
    const alerts = this.alertsFrom(await this.tenantHealth()); const hour = this.now().toISOString().slice(0, 13);
    for (const al of alerts) await this.notifier.notify({ kind: `ops.alert.${al.rule}`, audience: 'admins', payload: { rule: al.rule, severity: al.severity, text: al.text, value: al.value }, dedupeKey: `alert:${al.rule}:${hour}` });
    return alerts;
  }
  static async sweepAll(db: TenantDb, sys: SystemOps, now: () => Date = () => new Date()) {
    let alerts = 0;
    for (const t of (await sys.activeTenants()) as any[]) {
      try { alerts += (await runWithTenant(String(t._id), () => new OpsService(db, now).evaluate())).length; } catch { /* one tenant must not stop the others */ }
    }
    return { alerts };
  }
}
