import { Controller, Get, Header, Inject, Injectable, Module, NotFoundException, OnModuleInit, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import IORedis from 'ioredis';
import { OpsService } from '@leaddesk/domain';
import { SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import type { Metrics } from '@leaddesk/platform';
import type { SystemOps, TenantDb } from '@leaddesk/db';
import { Public, RequirePermission } from '../common/guards';
import { METRICS, SkipRateLimit } from '../hardening/hardening.module';

const ok = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

@Injectable()
export class OpsFacade implements OnModuleInit {
  private redis?: IORedis;
  constructor(@Inject(TENANT_DB) readonly db: TenantDb, @Inject(SYSTEM_OPS) private readonly sys: SystemOps, @Inject(METRICS) readonly metrics: Metrics) {}
  onModuleInit() {
    if (process.env.REDIS_URL) { this.redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }); this.redis.on('error', () => undefined); }
    // platform-wide gauges are read at scrape time: counts and ages only, never tenant data
    this.metrics.collect(async () => {
      const s = await this.sys.platformStats();
      const g = (n: string, h: string, v: number, l = {}) => this.metrics.gauge(n, h, v, l);
      g('leaddesk_inbox_pending', 'Webhook events waiting to be processed (received, processing or failed-retrying)', s.inboxPending);
      g('leaddesk_inbox_dead', 'Webhook events that exhausted their retries (dead-letter)', s.inboxDead);
      g('leaddesk_inbox_oldest_pending_seconds', 'Age of the oldest unprocessed webhook event', s.oldestPendingInboxS);
      g('leaddesk_outbox_backlog', 'Undispatched outbox events', s.outboxBacklog);
      g('leaddesk_outbox_oldest_seconds', 'Age of the oldest undispatched outbox event', s.oldestOutboxS);
      g('leaddesk_sla_claim_timers_overdue', 'Claim windows more than 2 minutes past due and not yet processed', s.slaClaimsOverdue);
      g('leaddesk_tasks_not_swept', 'Open tasks more than 20 minutes overdue that the sweeper has not marked missed', s.tasksUnswept);
      g('leaddesk_tenants_active', 'Active tenants', s.tenants);
      this.metrics.clearGauge('leaddesk_connections');
      for (const [status, n] of Object.entries(s.connections)) g('leaddesk_connections', 'Connections by status', n, { status });
    });
    const mem = () => { const m = process.memoryUsage(); this.metrics.gauge('process_resident_memory_bytes', 'Resident memory', m.rss); this.metrics.gauge('process_uptime_seconds', 'Process uptime', process.uptime()); };
    this.metrics.collect(mem);
  }
  async ready() {
    const checks: Record<string, string> = {};
    try { await withTimeout(this.db.conn.db!.admin().ping(), 2000); checks.mongo = 'ok'; } catch { checks.mongo = 'down'; }
    if (this.redis) { try { await withTimeout(this.redis.ping(), 2000); checks.redis = 'ok'; } catch { checks.redis = 'down'; } }
    return { ready: Object.values(checks).every((v) => v === 'ok'), checks };
  }
}

/** Unversioned operational endpoints for load balancers and Prometheus. */
@Controller()
export class HealthController {
  constructor(private readonly f: OpsFacade) {}
  @Public() @SkipRateLimit() @Get('healthz')
  live() { return { status: 'ok', uptimeS: Math.round(process.uptime()) }; } // process is up; deliberately touches nothing else

  @Public() @SkipRateLimit() @Get('readyz')
  async ready() { const r = await this.f.ready(); if (!r.ready) throw new ServiceUnavailableException({ code: 'not_ready', message: 'Dependencies are down', checks: r.checks }); return { status: 'ready', checks: r.checks }; }

  /** Bearer METRICS_TOKEN. Without a token configured it is disabled in production (and open only in development). */
  @Public() @SkipRateLimit() @Get('metrics') @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Req() req: Request, @Res() res: Response) {
    const token = process.env.METRICS_TOKEN;
    if (!token && process.env.NODE_ENV === 'production') throw new NotFoundException();
    if (token && !ok(String(req.headers.authorization ?? ''), `Bearer ${token}`)) { res.status(401).json({ code: 'unauthorized', message: 'Metrics need the bearer token' }); return; }
    res.send(await this.f.metrics.render());
  }
}

@Controller('v1/ops')
export class OpsController {
  constructor(private readonly f: OpsFacade) {}
  /** Admins: is the lead pipeline healthy for *this* workspace? */
  @Get('health') @RequirePermission('connections.manage')
  async health() { const svc = new OpsService(this.f.db); const h = await svc.tenantHealth(); return { ...h, alerts: svc.alertsFrom(h) }; }
}

/** Non-secret deployment facts the UI needs (e.g. where providers should send webhooks). */
@Controller('v1/app-config')
export class AppConfigController {
  @Get() config() { return { ingressUrl: (process.env.PUBLIC_INGRESS_URL ?? '').replace(/\/$/, '') || null, docsUrl: process.env.NODE_ENV === 'production' && process.env.ENABLE_DOCS !== '1' ? null : '/docs' }; }
}

/** First-run checklist for admins: computed from real data, so it can never get out of sync with what is configured. */
@Controller('v1/onboarding')
export class OnboardingController {
  constructor(private readonly f: OpsFacade) {}
  @Get() @RequirePermission('tenant.manage')
  async checklist() {
    const R = this.f.db.repos;
    const [sources, channels, members, rules, sla, leads, calls] = await Promise.all([
      R.connections.count({ category: 'lead_source', status: { $in: ['verified', 'degraded'] } }), R.connections.count({ category: { $in: ['whatsapp', 'sms'] }, status: { $in: ['verified', 'degraded'] } }),
      R.memberships.count({ status: 'active' }), R.rules.count({ active: true }), R.slaPolicies.count({ active: true }), R.leads.count({ deletedAt: null }), R.callSessions.count({}),
    ]);
    const steps = [
      { key: 'source', title: 'Connect a lead source', hint: 'Meta Lead Ads, Google Sheets or a website form: leads start arriving by themselves.', done: sources > 0, href: '/settings' },
      { key: 'team', title: 'Invite your team', hint: 'Agents see only their own leads and a single Today list.', done: members > 1, href: '/settings' },
      { key: 'routing', title: 'Choose how new leads are assigned', hint: 'Round-robin or by rule, with a claim window.', done: rules > 0, href: '/settings' },
      { key: 'sla', title: 'Set a first-contact promise', hint: 'e.g. every lead called within 15 minutes.', done: sla > 0, href: '/settings' },
      { key: 'messaging', title: 'Connect WhatsApp or SMS', hint: 'Optional: send templates and read replies inside LeadDesk.', done: channels > 0, href: '/settings' },
      { key: 'first_lead', title: 'Get your first lead', hint: 'Add one by hand, import a file, or wait for the first webhook.', done: leads > 0, href: '/today' },
      { key: 'first_call', title: 'Make your first call', hint: 'Open Today and tap Call.', done: calls > 0, href: '/today' },
    ];
    const done = steps.filter((x) => x.done).length;
    return { steps, done, total: steps.length, complete: done === steps.length };
  }
}

@Module({ controllers: [HealthController, OpsController, OnboardingController, AppConfigController], providers: [OpsFacade] })
export class OpsModule {}
