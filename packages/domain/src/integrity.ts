import { AuthRevokedError, type ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { sealSecret } from '@leaddesk/crypto';
import { requireTenantId, type TenantDb } from '@leaddesk/db';
import { ConnectionService, hintOf, type ConnStatus } from './connections';
import { InboxService } from './inbox';

export const TOKEN_REFRESH_DAYS = 10;
export const TOKEN_ALERT_DAYS = [7, 3, 1] as const;
const BIZ_START = 9, BIZ_END = 21; // local business hours used for silence detection
const STEP_MIN = 30;

/** Minutes of local business time elapsed between two instants (tenant timezone). */
export function businessMinutes(from: Date, to: Date, tz: string): number {
  if (to <= from) return 0;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  let mins = 0;
  for (let t = from.getTime(); t < to.getTime(); t += STEP_MIN * 60_000) {
    const h = Number(fmt.format(new Date(t)));
    if (h >= BIZ_START && h < BIZ_END) mins += Math.min(STEP_MIN, (to.getTime() - t) / 60_000);
  }
  return mins;
}

export interface SilenceVerdict { silent: boolean; baselineEvents: number; typicalGapMin?: number; thresholdMin?: number; silentForMin?: number }

/**
 * Learned silence: if a source normally delivers every X business-minutes and has been quiet for
 * max(3x its typical gap, 2h), it is silent. Needs a baseline (>= 10 events) so new sources never alarm.
 */
export function detectSilence(receivedAt: Date[], now: Date, tz: string): SilenceVerdict {
  const ts = [...receivedAt].sort((a, b) => a.getTime() - b.getTime());
  if (ts.length < 10) return { silent: false, baselineEvents: ts.length };
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push(businessMinutes(ts[i - 1], ts[i], tz));
  gaps.sort((a, b) => a - b);
  const typical = gaps[Math.floor(gaps.length / 2)];
  const threshold = Math.max(typical * 3, 120);
  const silentFor = businessMinutes(ts[ts.length - 1], now, tz);
  return { silent: silentFor > threshold, baselineEvents: ts.length, typicalGapMin: typical, thresholdMin: threshold, silentForMin: silentFor };
}

export interface Notifier { notify(n: { kind: string; audience: 'admins' | 'managers' | 'user'; userId?: string; payload: Record<string, unknown>; dedupeKey?: string }): Promise<void> }

export class DbNotifier implements Notifier {
  constructor(private readonly db: TenantDb) {}
  async notify(n: Parameters<Notifier['notify']>[0]) {
    try { await this.db.repos.notifications.create(n); }
    catch (e: any) { if (e?.code !== 11000) throw e; } // dedupeKey already used: stay quiet
  }
}

export interface HeartbeatResult { status: ConnStatus; changed: boolean; reasons: string[]; refreshed?: boolean; resubscribed?: boolean }

export class IntegrityService {
  private readonly conns: ConnectionService;
  private readonly inbox: InboxService;
  constructor(private readonly db: TenantDb, private readonly keys: KeyService, private readonly registry: ConnectorRegistry, private readonly notifier: Notifier = new DbNotifier(db), private readonly now: () => Date = () => new Date()) {
    this.conns = new ConnectionService(db, keys, registry);
    this.inbox = new InboxService(db, registry, 8, keys);
  }
  private get r() { return this.db.repos; }

  private async tenantTz(): Promise<string> {
    const t: any = await this.db.models.Tenant.findById(requireTenantId()).lean().exec();
    return t?.timezone ?? 'Asia/Kolkata';
  }

  private async transition(c: any, next: ConnStatus, reasons: string[]) {
    if (c.status === next) return false;
    await this.r.connections.updateOne({ _id: c._id }, { $set: { status: next, lastError: next === 'verified' ? null : reasons.join('; ').slice(0, 300) } });
    await this.conns.log(c._id, next === 'verified' ? 'info' : next === 'degraded' ? 'warn' : 'error', `Status ${c.status} -> ${next}${reasons.length ? `: ${reasons.join('; ')}` : ''}`);
    const bucket = this.now().toISOString().slice(0, 13);
    await this.notifier.notify({
      kind: `connection.${next}`, audience: 'admins',
      payload: { connectionId: String(c._id), name: c.name, provider: c.provider, from: c.status, to: next, reasons, reconnectPath: `/v1/connections/${c._id}/reconnect` },
      dedupeKey: `state:${c._id}:${next}:${bucket}`,
    });
    return true;
  }

  /** One heartbeat: token expiry/refresh, provider health, subscription check, silence detection, state machine. */
  async heartbeat(connectionId: string): Promise<HeartbeatResult> {
    const c0 = await this.conns.get(connectionId);
    if (c0.status === 'revoked') return { status: 'revoked', changed: false, reasons: ['revoked'] };
    const connector = this.conns.connector(c0.provider);
    const reasons: string[] = [];
    let hard: 'revoked' | 'failing' | null = null;
    let c = c0;
    const out: HeartbeatResult = { status: c0.status, changed: false, reasons };

    try {
      // 1. token expiry: proactive refresh at T-10d, alerts at T-7/T-3/T-1
      if (c.oauthExpiresAt) {
        const daysLeft = (new Date(c.oauthExpiresAt).getTime() - this.now().getTime()) / 86_400_000;
        if (daysLeft <= TOKEN_REFRESH_DAYS && connector.refresh) {
          try {
            const res = await connector.refresh(this.conns.contextFor(c));
            const sealed = await sealSecret(this.keys, { tenantId: requireTenantId(), connectionId: String(c._id) }, JSON.stringify(res.credentials));
            await this.r.connections.updateOne({ _id: c._id }, { $set: { secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: hintOf(res.credentials), oauthExpiresAt: res.expiresAt } });
            await this.conns.log(c._id, 'info', `Token refreshed; valid until ${res.expiresAt.toISOString().slice(0, 10)}`);
            await this.conns.recordCheck(c._id, 'token_refresh', true);
            c = await this.conns.get(connectionId); out.refreshed = true;
          } catch (e: any) {
            if (e instanceof AuthRevokedError) throw e;
            await this.conns.recordCheck(c._id, 'token_refresh', false, e?.message);
            reasons.push(`token refresh failed: ${e?.message}`);
          }
        }
        const left = (new Date(c.oauthExpiresAt).getTime() - this.now().getTime()) / 86_400_000;
        if (left <= 0) { hard = 'revoked'; reasons.push('access token expired'); }
        else for (const d of TOKEN_ALERT_DAYS) if (left <= d) {
          await this.notifier.notify({ kind: 'connection.token_expiring', audience: 'admins', payload: { connectionId: String(c._id), name: c.name, daysLeft: Math.ceil(left), reconnectPath: `/v1/connections/${c._id}/reconnect` }, dedupeKey: `token:${c._id}:${d}` });
        }
      }

      // 2. provider health ping
      if (!hard) {
        const h = await connector.health(this.conns.contextFor(c));
        await this.conns.recordCheck(c._id, 'health', h.ok, h.detail);
        if (!h.ok) reasons.push(`health check failed${h.detail ? `: ${h.detail}` : ''}`);
      }

      // 3. webhook subscription check (re-subscribe when missing)
      if (!hard && connector.ensureSubscribed) {
        const s = await connector.ensureSubscribed(this.conns.contextFor(c));
        await this.conns.recordCheck(c._id, 'subscription', s.ok, s.detail);
        if (s.fixed) { out.resubscribed = true; await this.conns.log(c._id, 'warn', `Webhook subscription was missing and has been re-created${s.detail ? `: ${s.detail}` : ''}`); }
        if (!s.ok) reasons.push(`webhook subscription broken${s.detail ? `: ${s.detail}` : ''}`);
      }
    } catch (e: any) {
      if (e instanceof AuthRevokedError) { hard = 'revoked'; reasons.push(e.message); await this.conns.recordCheck(c._id, 'auth', false, e.message); }
      else { reasons.push(`check error: ${String(e?.message ?? e).slice(0, 150)}`); }
    }

    // 4. silence detection (learned per source)
    if (!hard && connector.manifest.capabilities.some((x) => x === 'lead.subscribe' || x === 'lead.backfill')) {
      const since = new Date(this.now().getTime() - 14 * 86_400_000);
      const rows: any[] = await this.r.inbox.find({ connectionId: c._id, receivedAt: { $gte: since }, eventType: { $ne: 'test' } }, { sort: { receivedAt: -1 }, limit: 300, projection: { receivedAt: 1 } });
      const v = detectSilence(rows.map((x) => new Date(x.receivedAt)), this.now(), await this.tenantTz());
      await this.conns.recordCheck(c._id, 'silence', !v.silent, v.silent ? `quiet for ${Math.round(v.silentForMin!)} business min (normal gap ${Math.round(v.typicalGapMin!)}, alert after ${Math.round(v.thresholdMin!)})` : undefined);
      if (v.silent) reasons.push(`no leads for ${Math.round((v.silentForMin ?? 0) / 60)} business hours (unusual for this source)`);
    }

    // 5. state machine
    // consecutive failed heartbeats are tracked on the connection (a heartbeat = health + subscription + auth together)
    const infraFailed = reasons.some((x) => /health check|subscription|check error|token refresh/.test(x)) || hard === 'revoked';
    const prevFails: number = c.health?.consecutiveFailures ?? 0;
    const failures = infraFailed ? prevFails + 1 : 0;
    await this.r.connections.updateOne({ _id: c._id }, { $set: { 'health.consecutiveFailures': failures, 'health.lastHeartbeatAt': this.now() } });
    const consecutiveFailures = failures >= 3;
    let next: ConnStatus;
    if (hard === 'revoked') next = 'revoked';
    else if (consecutiveFailures) next = 'failing';
    else if (reasons.length) next = c.status === 'failing' ? 'failing' : 'degraded';
    else next = 'verified';
    out.changed = await this.transition(c, next, reasons);
    out.status = next;
    return out;
  }

  /**
   * Reconcile with the provider: pull the last `days` of leads and ingest any we never received
   * (dropped/blocked webhooks). Hourly 2 days, nightly 14 days, weekly 80 days (inside Meta's ~90d retention).
   */
  async backfill(connectionId: string, days: number): Promise<{ seen: number; missing: number; ingested: number; failed: number }> {
    const c = await this.conns.get(connectionId);
    const connector = this.conns.connector(c.provider);
    const stats = { seen: 0, missing: 0, ingested: 0, failed: 0 };
    let cursor: number | undefined;
    if (!connector.backfill || c.status === 'revoked') return stats;
    const since = new Date(this.now().getTime() - days * 86_400_000);
    try {
      for await (const lead of connector.backfill(this.conns.contextFor(c), since)) {
        stats.seen++;
        if (lead.cursor !== undefined) cursor = Math.max(cursor ?? 0, lead.cursor);
        const known = await this.r.inbox.findOne({ connectionId: c._id, externalEventId: lead.externalRef })
          ?? await this.r.leads.findOne({ externalRef: lead.externalRef, deletedAt: null });
        if (known) continue;
        stats.missing++;
        try {
          const row: any = await this.r.inbox.create({ connectionId: c._id, provider: c.provider, eventType: 'backfill', externalEventId: lead.externalRef, rawPayload: { ...lead.fields, _backfill: true, id: lead.externalRef }, signatureValid: true, status: 'received', receivedAt: this.now() });
          const res = await this.inbox.process(String(row._id));
          if (res.status === 'done') stats.ingested++; else stats.failed++;
        } catch (e: any) {
          if (e?.code === 11000) continue; // a webhook for this lead landed concurrently
          stats.failed++;
        }
      }
    } catch (e: any) {
      if (e instanceof AuthRevokedError) { await this.transition(c, 'revoked', [e.message]); return stats; }
      throw e;
    }
    if (cursor !== undefined) await this.r.connections.updateOne({ _id: c._id }, { $set: { 'config.backfillCursor': cursor } }); // failed rows already sit in Needs attention
    await this.conns.log(c._id, stats.missing ? 'warn' : 'info', `Backfill ${days}d: seen ${stats.seen}, missing ${stats.missing}, ingested ${stats.ingested}, failed ${stats.failed}`);
    await this.conns.recordCheck(c._id, 'backfill', stats.failed === 0, `${days}d seen=${stats.seen} missing=${stats.missing}`);
    return stats;
  }
}

/** What the scheduler enqueues; kept separate from BullMQ so the plan is testable. */
export type SweepKind = 'heartbeat' | 'backfill_hourly' | 'backfill_nightly' | 'backfill_weekly';
export const SWEEP_BACKFILL_DAYS: Record<Exclude<SweepKind, 'heartbeat'>, number> = { backfill_hourly: 2, backfill_nightly: 14, backfill_weekly: 80 };

export interface SweepJob { name: 'integrity.heartbeat' | 'integrity.backfill'; data: { tenantId: string; connectionId: string; days?: number }; jobId: string }

export function planSweep(kind: SweepKind, connections: { _id: unknown; tenantId: unknown }[], at: Date): SweepJob[] {
  const bucket = kind === 'heartbeat' ? Math.floor(at.getTime() / (5 * 60_000)) : kind === 'backfill_hourly' ? Math.floor(at.getTime() / 3_600_000) : Math.floor(at.getTime() / 86_400_000);
  return connections.map((c) => ({
    name: kind === 'heartbeat' ? 'integrity.heartbeat' as const : 'integrity.backfill' as const,
    data: { tenantId: String(c.tenantId), connectionId: String(c._id), ...(kind === 'heartbeat' ? {} : { days: SWEEP_BACKFILL_DAYS[kind] }) },
    jobId: `${kind}:${c._id}:${bucket}`, // same window => same jobId => enqueued once even if two schedulers run
  }));
}
