import { createHmac, timingSafeEqual } from 'node:crypto';

export type Category = 'lead_source' | 'voice' | 'whatsapp' | 'sms' | 'email' | 'ai' | 'feedback';
export type Capability =
  | 'lead.subscribe' | 'lead.backfill' | 'call.click_to_call' | 'call.webhook'
  | 'msg.send' | 'msg.inbound' | 'msg.status' | 'msg.templates' | 'email.send' | 'ai.chat' | 'ai.stt';

export interface FieldDef {
  key: string; label: string; type: 'text' | 'secret' | 'select' | 'phone';
  required: boolean; help?: string; pattern?: string;
  /** Platform generates the value (e.g. a webhook signing secret) and reveals it once. */
  generated?: boolean;
}

/** Minimal request shape so verification is framework-agnostic. */
export interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  query?: Record<string, string | undefined>;
}

export interface ConnectorManifest {
  id: string;
  category: Category;
  displayName: string;
  logo: string;
  docsUrl: string;
  auth: { type: 'oauth2' | 'api_key' | 'basic' | 'token' | 'none' };
  credentialFields: FieldDef[];
  configFields: FieldDef[];
  capabilities: Capability[];
  webhook?: {
    /** Which credential field holds the signing secret. */
    secretKey: string;
    verify(req: RawRequest, secret: string): boolean;
    extractEventId(req: RawRequest): string;
  };
}

/** The only events core code ever sees. */
export type CanonicalEvent =
  | { kind: 'LeadReceived'; externalRef: string; fields: Record<string, unknown> }
  | { kind: 'CallEvent'; callRef: string; state: 'ringing' | 'answered' | 'ended' | 'recording_ready' }
  | { kind: 'InboundMessage'; threadId: string; body: string }
  | { kind: 'MessageStatus'; providerMessageId: string; status: string }
  | { kind: 'TemplateStatus'; templateId: string; status: string };

export interface ConnectorContext {
  tenantId: string; connectionId: string; config: Record<string, unknown>;
  /** Decrypted in memory at call time only; never log or persist. */
  credentials: () => Promise<Record<string, string>>;
}

/** Throw from any connector call when the provider says the grant is gone (token revoked/app removed). */
export class AuthRevokedError extends Error {
  constructor(message = 'Authorization revoked by provider') { super(message); this.name = 'AuthRevokedError'; }
}

export interface BackfillLead { externalRef: string; fields: Record<string, unknown>; createdAt?: Date }
export interface HealthResult { ok: boolean; detail?: string }

export interface Connector {
  manifest: ConnectorManifest;
  verify(ctx: ConnectorContext): Promise<{ ok: boolean; detail?: string }>;
  health(ctx: ConnectorContext): Promise<HealthResult>;
  parseWebhook?(raw: unknown): Promise<CanonicalEvent[]>;
  /** Pull leads created since `since` so gaps left by dropped webhooks can be reconciled. */
  backfill?(ctx: ConnectorContext, since: Date): AsyncIterable<BackfillLead>;
  /** Exchange/refresh the access token; the platform stores the returned credentials encrypted. */
  refresh?(ctx: ConnectorContext): Promise<{ credentials: Record<string, string>; expiresAt: Date }>;
  /** Verify the provider-side webhook subscription still exists; re-create it when missing. */
  ensureSubscribed?(ctx: ConnectorContext): Promise<{ ok: boolean; fixed?: boolean; detail?: string }>;
}

export class ConnectorRegistry {
  private readonly byId = new Map<string, Connector>();
  register(c: Connector) {
    if (this.byId.has(c.manifest.id)) throw new Error(`Connector already registered: ${c.manifest.id}`);
    this.byId.set(c.manifest.id, c);
    return this;
  }
  get(id: string): Connector | undefined { return this.byId.get(id); }
  manifests() { return [...this.byId.values()].map((c) => c.manifest); }
}

/** Constant-time HMAC-SHA256 hex check, optional `sha256=` prefix. */
export function verifyHmacSha256(rawBody: Buffer, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const given = header.replace(/^sha256=/, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(given, 'hex'), b = Buffer.from(expected, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

const h = (req: RawRequest, name: string) => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/** Phase 0 reference connector: generic signed website webhook. */
export const websiteWebhook: Connector = {
  manifest: {
    id: 'website-webhook', category: 'lead_source', displayName: 'Website form (webhook)', logo: 'webhook', docsUrl: '',
    auth: { type: 'token' },
    credentialFields: [{ key: 'signingSecret', label: 'Signing secret', type: 'secret', required: true, generated: true, help: 'Sign the raw body with HMAC-SHA256 and send it as X-Signature-256: sha256=<hex>. Send a unique X-Event-Id per submission.' }],
    configFields: [{ key: 'fieldMapping', label: 'Field mapping (JSON: payload key -> target)', type: 'text', required: false }],
    capabilities: ['lead.subscribe'],
    webhook: {
      secretKey: 'signingSecret',
      verify: (req, secret) => verifyHmacSha256(req.rawBody, secret, h(req, 'x-signature-256')),
      extractEventId: (req) => h(req, 'x-event-id') ?? '',
    },
  },
  async verify() { return { ok: true }; },
  async health() { return { ok: true }; },
  async parseWebhook(raw) {
    const o = raw as Record<string, unknown>;
    return [{ kind: 'LeadReceived', externalRef: String(o.id ?? ''), fields: o }];
  },
};

export function defaultRegistry() { return new ConnectorRegistry().register(websiteWebhook); }
