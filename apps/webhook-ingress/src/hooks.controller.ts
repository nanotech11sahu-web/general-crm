import { All, Controller, Headers, HttpCode, Inject, Logger, NotFoundException, Param, Query, Req, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { ConnectorRegistry } from '@leaddesk/connectors-core';
import { openSecret, type KeyService } from '@leaddesk/crypto';
import { runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';
import { KEY_SERVICE, SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { INBOX_QUEUE, type InboxQueue } from './inbox-queue';

export const REGISTRY = Symbol('REGISTRY');

@Controller('hooks')
export class HooksController {
  private readonly log = new Logger('Ingress');
  private readonly secretCache = new Map<string, { v: string; exp: number }>();

  constructor(
    @Inject(SYSTEM_OPS) private readonly sys: SystemOps,
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    @Inject(REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(INBOX_QUEUE) private readonly queue: InboxQueue,
  ) {}

  private async secretOf(c: any): Promise<string> {
    const id = String(c._id);
    const hit = this.secretCache.get(id);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = await openSecret(this.keys, { tenantId: String(c.tenantId), connectionId: id }, { ciphertext: c.secretCiphertext, wrappedDek: c.secretWrappedDek });
    this.secretCache.set(id, { v, exp: Date.now() + 60_000 });
    return v;
  }

  /** GET is reserved for provider verification challenges; a connector must opt in (none do yet). */
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
    if (!connector?.manifest.webhook) throw new NotFoundException();

    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const raw = { headers, rawBody, query };
    const valid = connector.manifest.webhook.verify(raw, await this.secretOf(conn));
    if (!valid) {
      this.log.warn(`invalid signature provider=${provider} connection=${conn._id} tenant=${conn.tenantId}`);
      throw new UnauthorizedException();
    }

    const externalEventId = connector.manifest.webhook.extractEventId(raw) || createHash('sha256').update(rawBody).digest('hex');
    const tenantId = String(conn.tenantId);
    return runWithTenant(tenantId, async () => {
      // idempotent: unique (tenantId, connectionId, externalEventId); first writer wins
      const res: any = await this.db.models.IntegrationInbox.findOneAndUpdate(
        { connectionId: conn._id, externalEventId },
        { $setOnInsert: { provider, eventType: 'webhook', rawPayload: safeJson(rawBody), signatureValid: true, status: 'received', attempts: 0, receivedAt: new Date(), tenantId: conn.tenantId } },
        { upsert: true, new: true, includeResultMetadata: true },
      ).exec();
      const created = !res.lastErrorObject?.updatedExisting;
      if (created) await this.queue.enqueue({ tenantId, inboxId: String(res.value._id) });
      return { ok: true, duplicate: !created };
    });
  }
}

function safeJson(b: Buffer): unknown {
  try { return JSON.parse(b.toString('utf8')); } catch { return { _raw: b.toString('utf8').slice(0, 10_000) }; }
}
