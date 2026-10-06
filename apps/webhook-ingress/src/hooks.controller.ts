import { All, Controller, ForbiddenException, Get, Headers, HttpCode, Inject, Logger, NotFoundException, Param, Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ConnectorRegistry } from '@leaddesk/connectors-core';
import { leadgenChanges, metaChallenge, splitWhatsAppWebhook, whatsappChallenge } from '@leaddesk/connectors';
import { openSecret, type KeyService } from '@leaddesk/crypto';
import { runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';
import { KEY_SERVICE, SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { INBOX_QUEUE, type InboxQueue } from './inbox-queue';

export const REGISTRY = Symbol('REGISTRY');

/** Idempotent store-then-enqueue shared by every ingress route. First writer wins. */
async function ingest(db: TenantDb, queue: InboxQueue, conn: any, e: { provider: string; externalEventId: string; payload: unknown; eventType?: string }) {
  const tenantId = String(conn.tenantId);
  return runWithTenant(tenantId, async () => {
    const res: any = await db.models.IntegrationInbox.findOneAndUpdate(
      { connectionId: conn._id, externalEventId: e.externalEventId },
      { $setOnInsert: { provider: e.provider, eventType: e.eventType ?? 'webhook', rawPayload: e.payload, signatureValid: true, status: 'received', attempts: 0, receivedAt: new Date(), tenantId: conn.tenantId } },
      { upsert: true, new: true, includeResultMetadata: true },
    ).exec();
    const created = !res.lastErrorObject?.updatedExisting;
    if (created) await queue.enqueue({ tenantId, inboxId: String(res.value._id) });
    return { duplicate: !created };
  });
}

/** Exotel posts application/x-www-form-urlencoded; everyone else posts JSON. Raw bytes are verified before this runs. */
const parseBody = (b: Buffer, contentType = ''): unknown => {
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(b.toString('utf8')));
  return safeJson(b);
};
const safeJson = (b: Buffer): unknown => { try { return JSON.parse(b.toString('utf8')); } catch { return { _raw: b.toString('utf8').slice(0, 10_000) }; } };

/**
 * App-level webhook for Meta: one callback URL for the whole app, so routing is by page id
 * (leadgen change -> every live connection that owns that page). Registered before the generic route.
 */
@Controller('hooks/meta-leadads')
export class MetaHooksController {
  private readonly log = new Logger('IngressMeta');
  constructor(
    @Inject(SYSTEM_OPS) private readonly sys: SystemOps,
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(INBOX_QUEUE) private readonly queue: InboxQueue,
  ) {}

  /** Subscription handshake. */
  @Get()
  challenge(@Query() q: Record<string, string>, @Res() res: Response) {
    const c = metaChallenge(q, process.env.META_WEBHOOK_VERIFY_TOKEN ?? '');
    if (c === null || !process.env.META_WEBHOOK_VERIFY_TOKEN) throw new ForbiddenException();
    res.status(200).type('text/plain').send(c);
  }

  @Post() @HttpCode(200)
  async events(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    const connector = this.registry.get('meta-leadads');
    if (!connector?.manifest.webhook) throw new NotFoundException();
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    if (!connector.manifest.webhook.verify({ headers, rawBody }, process.env.META_APP_SECRET ?? '')) {
      this.log.warn('invalid Meta signature');
      throw new UnauthorizedException();
    }
    let accepted = 0, unmatched = 0;
    for (const ch of leadgenChanges(safeJson(rawBody))) {
      const conns = await this.sys.resolveConnectionsByPage('meta-leadads', ch.pageId);
      if (!conns.length) { unmatched++; continue; }
      for (const conn of conns) { await ingest(this.db, this.queue, conn, { provider: 'meta-leadads', externalEventId: String(ch.value.leadgen_id), payload: { ...ch.value, page_id: ch.pageId } }); accepted++; }
    }
    if (unmatched) this.log.warn(`${unmatched} leadgen change(s) for pages with no connection`);
    return { ok: true, accepted }; // always 200 for a valid signature so Meta never disables the subscription
  }
}

/** App-level WhatsApp Cloud webhook: messages/statuses route by phone_number_id, template updates by WABA id. */
@Controller('hooks/whatsapp-cloud')
export class WhatsAppHooksController {
  private readonly log = new Logger('IngressWhatsApp');
  constructor(
    @Inject(SYSTEM_OPS) private readonly sys: SystemOps,
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(INBOX_QUEUE) private readonly queue: InboxQueue,
  ) {}

  @Get()
  challenge(@Query() q: Record<string, string>, @Res() res: Response) {
    const token = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
    const c = token ? whatsappChallenge(q, token) : null;
    if (c === null) throw new ForbiddenException();
    res.status(200).type('text/plain').send(c);
  }

  @Post() @HttpCode(200)
  async events(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | string[] | undefined>) {
    const connector = this.registry.get('whatsapp-cloud');
    if (!connector?.manifest.webhook) throw new NotFoundException();
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    if (!connector.manifest.webhook.verify({ headers, rawBody }, process.env.META_APP_SECRET ?? '')) { this.log.warn('invalid WhatsApp signature'); throw new UnauthorizedException(); }
    let accepted = 0, unmatched = 0;
    for (const row of splitWhatsAppWebhook(safeJson(rawBody))) {
      const conns = row.route.phoneNumberId ? await this.sys.resolveConnectionsByPhoneNumber('whatsapp-cloud', row.route.phoneNumberId) : await this.sys.resolveConnectionsByWaba('whatsapp-cloud', row.route.wabaId ?? '');
      if (!conns.length) { unmatched++; continue; }
      for (const conn of conns) { await ingest(this.db, this.queue, conn, { provider: 'whatsapp-cloud', externalEventId: row.eventId, payload: row.payload }); accepted++; }
    }
    if (unmatched) this.log.warn(`${unmatched} WhatsApp event(s) for numbers with no connection`);
    return { ok: true, accepted };
  }
}

/** Liveness/readiness for the load balancer (no tenant data, no auth). */
@Controller()
export class HealthController {
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}
  @Get('healthz') live() { return { status: 'ok' }; }
  @Get('readyz') async ready() {
    try { await Promise.race([this.db.conn.db!.admin().ping(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 2000))]); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException({ code: 'not_ready', message: 'Database is down' }); }
  }
}

@Controller('hooks')
export class HooksController {
  private readonly log = new Logger('Ingress');
  private readonly secretCache = new Map<string, { v: Record<string, string>; exp: number }>();

  constructor(
    @Inject(SYSTEM_OPS) private readonly sys: SystemOps,
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    @Inject(REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(INBOX_QUEUE) private readonly queue: InboxQueue,
  ) {}

  private async credsOf(c: any): Promise<Record<string, string>> {
    const id = String(c._id);
    const hit = this.secretCache.get(id);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = JSON.parse(await openSecret(this.keys, { tenantId: String(c.tenantId), connectionId: id }, { ciphertext: c.secretCiphertext, wrappedDek: c.secretWrappedDek })) as Record<string, string>;
    this.secretCache.set(id, { v, exp: Date.now() + 60_000 });
    return v;
  }

  /** GET is reserved for provider verification challenges; a connector must opt in (none per-connection do). */
  @All(':provider/:publicId')
  @HttpCode(200)
  async hook(
    @Param('provider') provider: string,
    @Param('publicId') publicId: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: Record<string, string | undefined>,
  ) {
    if (req.method === 'GET') throw new NotFoundException();
    const conn: any = await this.sys.resolveConnection(publicId);
    if (!conn || conn.provider !== provider || conn.status === 'revoked') throw new NotFoundException();
    const connector = this.registry.get(provider);
    if (!connector?.manifest.webhook || connector.manifest.webhook.appLevel) throw new NotFoundException();

    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const raw = { headers, rawBody, query };
    const creds = await this.credsOf(conn);
    if (!connector.manifest.webhook.verify(raw, creds[connector.manifest.webhook.secretKey] ?? '')) {
      this.log.warn(`invalid signature provider=${provider} connection=${conn._id} tenant=${conn.tenantId}`);
      throw new UnauthorizedException();
    }
    const externalEventId = connector.manifest.webhook.extractEventId(raw) || createHash('sha256').update(rawBody).digest('hex');
    const r = await ingest(this.db, this.queue, conn, { provider, externalEventId, payload: parseBody(rawBody, String(headers['content-type'] ?? '')) });
    return { ok: true, duplicate: r.duplicate };
  }
}
