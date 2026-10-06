import { randomBytes } from 'node:crypto';
import { openSecret, sealSecret, type KeyService } from '@leaddesk/crypto';
import type { ConnectorContext, ConnectorRegistry, FieldDef, VerifyResult } from '@leaddesk/connectors-core';
import { newObjectId, requireTenantId, type TenantDb } from '@leaddesk/db';
import { BillingService } from './billing';
import { DomainError, notFound } from './errors';

export type ConnStatus = 'pending' | 'verified' | 'degraded' | 'failing' | 'revoked';

const check = (f: FieldDef, v: string) => {
  if (f.required && !v) return `${f.label} is required`;
  if (v && f.pattern && !new RegExp(f.pattern).test(v)) return `${f.label} has an invalid format`;
  return undefined;
};

/** Display hint: last 4 chars of the last credential value (never derived from the JSON envelope). */
export const hintOf = (creds: Record<string, string>) => `••••${(Object.values(creds).filter(Boolean).pop() ?? '').slice(-4)}`;

/** Secrets never leave this class except as a one-time reveal of platform-generated values. */
export class ConnectionService {
  constructor(private readonly db: TenantDb, private readonly keys: KeyService, private readonly registry: ConnectorRegistry) {}
  private get r() { return this.db.repos; }

  connector(provider: string) {
    const c = this.registry.get(provider);
    if (!c) throw new DomainError('unknown_provider', `Unknown provider: ${provider}`);
    return c;
  }

  view(c: any) {
    return {
      id: String(c._id), provider: c.provider, category: c.category, name: c.name, status: c.status as ConnStatus,
      publicId: c.publicId, webhookPath: `/hooks/${c.provider}/${c.publicId}`, secretHint: c.secretHint,
      config: c.config ?? {}, lastVerifiedAt: c.lastVerifiedAt ?? null, lastEventAt: c.lastEventAt ?? null,
      lastError: c.lastError ?? null, oauthExpiresAt: c.oauthExpiresAt ?? null, health: c.health ?? {},
    };
  }

  private prepare(provider: string, creds: Record<string, string> = {}, config: Record<string, unknown> = {}) {
    const m = this.connector(provider).manifest;
    const errors: Record<string, string> = {};
    const out: Record<string, string> = {};
    const revealed: Record<string, string> = {};
    for (const f of m.credentialFields) {
      let v = String(creds[f.key] ?? '').trim();
      if (!v && f.generated) { v = randomBytes(32).toString('base64url'); revealed[f.key] = v; }
      const e = check(f, v);
      if (e) errors[f.key] = e;
      out[f.key] = v;
    }
    for (const f of m.configFields) { const e = check(f, String(config[f.key] ?? '')); if (e) errors[f.key] = e; }
    for (const k of Object.keys(creds)) if (!m.credentialFields.some((f) => f.key === k)) errors[k] = 'unknown credential field';
    if (Object.keys(errors).length) throw new DomainError('invalid_connection', 'Invalid connection settings', errors);
    return { m, creds: out, revealed };
  }

  private async seal(id: unknown, creds: Record<string, string>) {
    const sealed = await sealSecret(this.keys, { tenantId: requireTenantId(), connectionId: String(id) }, JSON.stringify(creds));
    return { secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: hintOf(creds) };
  }

  async create(i: { provider: string; name: string; credentials?: Record<string, string>; config?: Record<string, unknown> }) {
    const { m, creds, revealed } = this.prepare(i.provider, i.credentials, i.config);
    await new BillingService(this.db).assertCanConnect(m.category); // plan limits (connections, cloud calling, AI)
    const id = newObjectId();
    const conn: any = await this.r.connections.create({
      _id: id, provider: m.id, category: m.category, name: i.name, publicId: randomBytes(18).toString('base64url'),
      status: 'pending', config: i.config ?? {}, ...(await this.seal(id, creds)),
    });
    await this.log(id, 'info', 'Connection created');
    const verified = await this.verify(String(id));
    return { connection: verified, revealedOnce: revealed, capabilities: m.capabilities, conn };
  }

  async get(id: string) {
    const c: any = await this.r.connections.findById(id);
    if (!c) throw notFound('Connection');
    return c;
  }
  async list() { return (await this.r.connections.find({}, { sort: { _id: 1 } })).map((c: any) => this.view(c)); }

  contextFor(c: any): ConnectorContext {
    const tenantId = requireTenantId();
    return { tenantId, connectionId: String(c._id), config: c.config ?? {}, credentials: () => this.credentials(c) };
  }

  /** Decrypt only at call time, in memory. */
  async credentials(c: any): Promise<Record<string, string>> {
    const plain = await openSecret(this.keys, { tenantId: requireTenantId(), connectionId: String(c._id) }, { ciphertext: c.secretCiphertext, wrappedDek: c.secretWrappedDek });
    return JSON.parse(plain);
  }

  async log(connectionId: unknown, level: 'info' | 'warn' | 'error', message: string, meta?: unknown) {
    await this.r.integrationLogs.create({ connectionId, level, message: message.slice(0, 500), meta, at: new Date() });
  }
  async recordCheck(connectionId: unknown, name: string, ok: boolean, detail?: string) {
    await this.r.healthChecks.create({ connectionId, check: name, ok, detail: detail?.slice(0, 300), at: new Date() });
  }

  /** Safe, read-only provider call. Success unlocks capabilities; failure keeps the connection pending/failing with a reason. */
  async verify(id: string) {
    const c = await this.get(id);
    if (c.status === 'revoked') throw new DomainError('revoked', 'Connection is revoked; reconnect it first');
    const connector = this.connector(c.provider);
    let ok = false; let detail: string | undefined; let res: VerifyResult | undefined;
    try { res = await connector.verify(this.contextFor(c)); ({ ok, detail } = res); } catch (e: any) { detail = String(e?.message ?? e).slice(0, 300); }
    if (ok && res?.patch) await this.applyPatch(c, res.patch);
    await this.recordCheck(c._id, 'verify', ok, detail);
    await this.r.connections.updateOne({ _id: c._id }, { $set: ok ? { status: 'verified', lastVerifiedAt: new Date(), lastError: null } : { lastError: detail ?? 'verification failed' } });
    await this.log(c._id, ok ? 'info' : 'error', ok ? 'Verified' : `Verification failed: ${detail}`);
    return this.view(await this.get(id));
  }

  /** Persist what verification discovered (pages, rotated tokens, expiry). Credentials are re-sealed. */
  async applyPatch(c: any, patch: NonNullable<VerifyResult['patch']>) {
    const set: Record<string, unknown> = {};
    if (patch.credentials) {
      const merged = { ...(await this.credentials(c)), ...patch.credentials };
      Object.assign(set, await this.seal(c._id, merged));
    }
    if (patch.config) set.config = { ...(c.config ?? {}), ...patch.config };
    if (patch.oauthExpiresAt !== undefined) set.oauthExpiresAt = patch.oauthExpiresAt;
    if (Object.keys(set).length) await this.r.connections.updateOne({ _id: c._id }, { $set: set });
  }

  /** Replace credentials: re-verify with the NEW ones first and only swap on success. */
  async replaceCredentials(id: string, credentials: Record<string, string>, config?: Record<string, unknown>) {
    const c = await this.get(id);
    const { creds, revealed } = this.prepare(c.provider, credentials, config ?? c.config);
    const probe = { ...c, ...(await this.seal(c._id, creds)), config: config ?? c.config };
    const res = await this.connector(c.provider).verify(this.contextFor(probe)).catch((e: any) => ({ ok: false, detail: String(e?.message ?? e) }));
    await this.recordCheck(c._id, 'reconnect', res.ok, res.detail);
    if (!res.ok) throw new DomainError('verify_failed', `New credentials failed verification: ${res.detail ?? 'unknown error'}`);
    await this.r.connections.updateOne({ _id: c._id }, { $set: { secretCiphertext: probe.secretCiphertext, secretWrappedDek: probe.secretWrappedDek, secretKeyRef: probe.secretKeyRef, secretHint: probe.secretHint, config: probe.config, status: 'verified', lastVerifiedAt: new Date(), lastError: null } });
    await this.log(c._id, 'info', 'Credentials replaced and verified');
    return { connection: this.view(await this.get(id)), revealedOnce: revealed };
  }

  async setConfig(id: string, patch: Record<string, unknown>) {
    const c = await this.get(id);
    const m = this.connector(c.provider).manifest;
    const allowed = new Set(m.configFields.map((f) => f.key));
    for (const k of Object.keys(patch)) if (!allowed.has(k)) throw new DomainError('invalid_connection', `Unknown config field: ${k}`);
    await this.r.connections.updateOne({ _id: c._id }, { $set: { config: { ...(c.config ?? {}), ...patch } } });
    return this.view(await this.get(id));
  }

  async revoke(id: string) {
    const c = await this.get(id);
    await this.r.connections.updateOne({ _id: c._id }, { $set: { status: 'revoked' } });
    await this.log(c._id, 'warn', 'Connection revoked');
  }

  async logs(id: string, limit = 100) {
    await this.get(id);
    return this.r.integrationLogs.find({ connectionId: id }, { sort: { at: -1 }, limit: Math.min(limit, 500) });
  }
  async checks(id: string, limit = 50) {
    await this.get(id);
    return this.r.healthChecks.find({ connectionId: id }, { sort: { at: -1 }, limit });
  }
}
