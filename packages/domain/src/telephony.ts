import type { CanonicalEvent, ConnectorRegistry } from '@leaddesk/connectors-core';
import type { KeyService } from '@leaddesk/crypto';
import { getContext, requireTenantId, toObjectId, type TenantDb } from '@leaddesk/db';
import { ConnectionService } from './connections';
import { DoService } from './do';
import { DomainError, notFound } from './errors';
import { LeadService } from './lead-service';
import { PresenceService } from './routing';
import type { ObjectStore } from './storage';

type CallEvent = Extract<CanonicalEvent, { kind: 'CallEvent' }>;

/**
 * Click-to-call. With a voice connection and a mapped agent number the call is platform-routed (agent rung first,
 * lead bridged, number never shown, duration/recording system-verified). Otherwise it falls back to tap-to-call
 * (mode B) with self-reported duration. Both modes feed the same call_session + outcome flow.
 */
export class TelephonyService {
  private readonly conns: ConnectionService;
  private readonly leads: LeadService;
  private readonly doSvc: DoService;
  private readonly presence: PresenceService;
  constructor(private readonly db: TenantDb, keys: KeyService, private readonly registry: ConnectorRegistry, private readonly store: ObjectStore, private readonly o: { publicIngressUrl?: string; now?: () => Date } = {}) {
    this.conns = new ConnectionService(db, keys, registry);
    this.leads = new LeadService(db);
    this.doSvc = new DoService(db, o.now);
    this.presence = new PresenceService(db, o.now);
  }
  private get r() { return this.db.repos; }
  private now() { return this.o.now?.() ?? new Date(); }
  private actor(): string { const id = getContext()?.userId; if (!id) throw new DomainError('unauthenticated', 'No acting user', undefined, 401); return id; }

  private async voiceConnection() {
    for (const c of (await this.r.connections.find({ category: 'voice', status: { $in: ['verified', 'degraded'] } })) as any[]) {
      if (this.registry.get(c.provider)?.manifest.capabilities.includes('call.click_to_call')) return c;
    }
    return null;
  }
  private agentNumber(conn: any, userId: string): string | null {
    let map: Record<string, string> = {};
    try { const raw = conn.config?.agentNumbers; map = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}; } catch { /* malformed config: treated as unmapped */ }
    const n = map[userId]; return n && /^\+?\d{8,15}$/.test(n) ? n : null;
  }

  /** `mode` tells the UI what to do: `cloud` => wait for the phone to ring; `tap` => open the dialer with `dialUri`. */
  async dial(leadId: string): Promise<{ mode: 'cloud' | 'tap'; callSessionId: string; dialUri?: string }> {
    const agent = this.actor();
    if (((await this.leads.get(leadId)).tags ?? []).includes('demo')) throw new DomainError('demo_lead', 'Sample leads cannot be called', undefined, 409);
    const conn = await this.voiceConnection();
    const agentNumber = conn ? this.agentNumber(conn, agent) : null;
    if (!conn || !agentNumber) return { mode: 'tap', ...(await this.doSvc.startCall(leadId)) };

    const lead: any = await this.leads.get(leadId);
    const pending: any = await this.r.callSessions.findOne({ agentId: toObjectId(agent), outcomeLoggedAt: null, state: { $in: ['dialed', 'ringing', 'answered', 'ended'] } });
    if (pending) throw new DomainError('outcome_pending', 'Finish your current call and log its outcome first', { callSessionId: String(pending._id) }, 409);
    const phone = (lead.contacts ?? []).find((c: any) => c.kind === 'phone' && !(c.optedOutChannels ?? []).includes('call')) ?? (lead.contacts ?? []).find((c: any) => c.kind === 'phone');
    if (!phone) throw new DomainError('no_phone', 'This lead has no phone number');
    const creds = await this.conns.credentials(conn);
    const base = (this.o.publicIngressUrl ?? process.env.PUBLIC_INGRESS_URL ?? '').replace(/\/$/, '');
    if (!base) throw new DomainError('not_configured', 'PUBLIC_INGRESS_URL is not configured, so the provider cannot call us back');
    const session: any = await this.r.callSessions.create({ leadId: lead._id, agentId: toObjectId(agent), connectionId: conn._id, mode: 'cloud', direction: 'out', state: 'ringing', startedAt: this.now(), durationSource: 'system' });
    try {
      const res = await this.registry.get(conn.provider)!.startCall!(this.conns.contextFor(conn), {
        agentNumber, leadNumber: phone.valueNorm, record: true,
        callbackUrl: `${base}/hooks/${conn.provider}/${conn.publicId}?token=${encodeURIComponent(creds.webhookToken ?? '')}`,
      });
      await this.r.callSessions.updateOne({ _id: session._id }, { $set: { providerCallId: res.providerCallId } });
    } catch (e: any) {
      // the call never started: don't leave the agent blocked behind an outcome sheet for a call that did not happen
      await this.r.callSessions.updateOne({ _id: session._id }, { $set: { state: 'missed', endedAt: this.now() } });
      await this.conns.log(conn._id, 'error', `Click-to-call failed: ${String(e?.message ?? e)}`);
      throw new DomainError('call_failed', 'The call could not be started. Try again or use your own phone.', undefined, 502);
    }
    await this.presence.set(agent, 'on_call');
    await this.r.activities.create({ leadId: lead._id, type: 'call_started', actorId: toObjectId(agent), channel: 'voice', payload: { callSessionId: String(session._id), mode: 'cloud' }, occurredAt: this.now() });
    return { mode: 'cloud', callSessionId: String(session._id) };
  }

  /** Provider webhook -> call session (system-verified duration and recording). */
  async handleEvent(conn: any, e: CallEvent) {
    const s: any = await this.r.callSessions.findOne({ providerCallId: e.callRef, connectionId: conn._id });
    if (!s) return { unknown: true };
    if (e.state === 'answered') {
      if (s.state === 'ringing' || s.state === 'dialed') await this.r.callSessions.updateOne({ _id: s._id }, { $set: { state: 'answered', answeredAt: this.now() } });
      return { state: 'answered' };
    }
    if (e.state === 'ended') {
      if (s.endedAt && s.state === 'ended') return { state: 'ended', duplicate: true };
      const upd = await this.r.callSessions.updateOne({ _id: s._id, state: { $in: ['ringing', 'answered', 'dialed'] } }, { $set: { state: 'ended', endedAt: this.now(), durationS: e.durationS ?? 0, durationSource: 'system', providerOutcome: e.outcome } });
      if (upd.modifiedCount === 1) {
        await this.presence.set(String(s.agentId), 'online');
        await this.r.outbox.add('call.ended', String(s._id), { agentId: String(s.agentId), leadId: String(s.leadId), durationS: e.durationS ?? 0, outcome: e.outcome });
      }
      return { state: 'ended' };
    }
    if (e.state === 'recording_ready' && e.recordingUrl) {
      if (s.recordingObjectKey) return { recorded: true, duplicate: true };
      const connector = this.registry.get(conn.provider);
      if (!connector?.fetchRecording) return { recorded: false };
      const { bytes, contentType } = await connector.fetchRecording(this.conns.contextFor(conn), e.recordingUrl); // throws => retried by the queue
      const key = `tenants/${requireTenantId()}/recordings/${s._id}.mp3`;
      await this.store.put(key, bytes, contentType);
      await this.r.callSessions.updateOne({ _id: s._id }, { $set: { recordingObjectKey: key } });
      return { recorded: true };
    }
    return { state: e.state };
  }

  /** Managers/admins only (enforced by the caller's permission); a short-lived URL, never the object key. */
  async recordingUrl(callSessionId: string, ttlSeconds = 300) {
    const s: any = await this.r.callSessions.findById(callSessionId);
    if (!s) throw notFound('Call');
    if (!s.recordingObjectKey) throw new DomainError('no_recording', 'No recording for this call', undefined, 404);
    return { url: await this.store.signedUrl(s.recordingObjectKey, ttlSeconds), expiresInSeconds: ttlSeconds };
  }

  calls(leadId: string) { return this.r.callSessions.find({ leadId: toObjectId(leadId) }, { sort: { startedAt: -1 }, limit: 50, projection: { recordingObjectKey: 0 } }); }
}
