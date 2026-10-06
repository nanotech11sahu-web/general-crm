import { AuthRevokedError, createHttp, HttpError, verifyToken, type CanonicalEvent, type Connector, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';

export interface ExotelEnv { fetch?: FetchLike }
const HOSTS = ['api.exotel.com', 'api.in.exotel.com', 'api.exotel.in'];
const digits = (e164: string) => e164.replace(/\D/g, '');

/** Exotel "connect two numbers": rings the agent first, then bridges to the lead. Documented shapes; not verified against a live account. */
export function createExotel(env: ExotelEnv = {}): Connector {
  const http = createHttp({ allowedHosts: HOSTS, allowedSuffixes: ['.exotel.com', '.exotel.in'], fetch: env.fetch });
  const conf = (ctx: ConnectorContext) => ({ sid: String(ctx.config.accountSid ?? ''), host: String(ctx.config.subdomain || 'api.exotel.com'), callerId: String(ctx.config.callerId ?? '') });
  const basic = async (ctx: ConnectorContext) => { const c = await ctx.credentials(); return `Basic ${Buffer.from(`${c.apiKey}:${c.apiToken}`).toString('base64')}`; };
  const guard = (e: unknown) => { if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new AuthRevokedError('Exotel rejected the API key/token'); throw e; };

  return {
    manifest: {
      id: 'telephony-exotel', category: 'voice', displayName: 'Exotel (cloud telephony)', logo: 'exotel', docsUrl: 'https://developer.exotel.com/',
      auth: { type: 'basic' },
      credentialFields: [
        { key: 'apiKey', label: 'API key', type: 'secret', required: true },
        { key: 'apiToken', label: 'API token', type: 'secret', required: true },
        { key: 'webhookToken', label: 'Webhook token', type: 'secret', required: true, generated: true, help: 'The call-status callback URL we give Exotel carries this token.' },
      ],
      configFields: [
        { key: 'accountSid', label: 'Account SID', type: 'text', required: true, pattern: '^[A-Za-z0-9_-]{3,60}$' },
        { key: 'subdomain', label: 'API host', type: 'text', required: false, help: 'api.exotel.com (default) or api.in.exotel.com' },
        { key: 'callerId', label: 'ExoPhone (caller id)', type: 'phone', required: true, pattern: '^\\+?\\d{8,15}$' },
        { key: 'agentNumbers', label: 'Agent numbers (JSON: userId -> phone)', type: 'text', required: false },
      ],
      capabilities: ['call.click_to_call', 'call.webhook'],
      webhook: {
        secretKey: 'webhookToken',
        verify: (req, secret) => verifyToken(req, secret),
        extractEventId: (req) => { try { const o = JSON.parse(req.rawBody.toString('utf8')); return `${o.CallSid ?? o.callsid ?? ''}:${o.Status ?? o.status ?? ''}${o.RecordingUrl ? ':rec' : ''}`; } catch { return ''; } },
      },
    },

    // read-only: list one call. Proves the key/token/sid/host without placing a call.
    async verify(ctx) {
      const { sid, host } = conf(ctx);
      try { await http.json(`https://${host}/v1/Accounts/${encodeURIComponent(sid)}/Calls.json?PageSize=1`, { headers: { authorization: await basic(ctx) } }); }
      catch (e) { if (e instanceof HttpError && e.status === 404) return { ok: false, detail: 'Account SID or API host looks wrong' }; guard(e); }
      return { ok: true };
    },
    async health(ctx) { const r = await this.verify(ctx); return { ok: r.ok, detail: r.detail }; },

    async startCall(ctx, req) {
      const { sid, host, callerId } = conf(ctx);
      const form = new URLSearchParams({ From: req.agentNumber, To: req.leadNumber, CallerId: callerId, StatusCallback: req.callbackUrl, 'StatusCallbackEvents[0]': 'terminal', StatusCallbackContentType: 'application/json', ...(req.record ? { Record: 'true', RecordingChannels: 'dual', RecordingFormat: 'mp3' } : {}) });
      try {
        const r = await http.json<any>(`https://${host}/v1/Accounts/${encodeURIComponent(sid)}/Calls/connect.json`, { method: 'POST', headers: { authorization: await basic(ctx), 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        const id = r.Call?.Sid ?? r.call?.sid;
        if (!id) throw new Error('Exotel did not return a call id');
        return { providerCallId: String(id) };
      } catch (e) { return guard(e); }
    },

    async fetchRecording(ctx, url) { return http.bytes(url, { headers: { authorization: await basic(ctx) } }); },

    /** Status callbacks (JSON or form-encoded, flattened by the ingress). */
    async parseWebhook(raw: any): Promise<CanonicalEvent[]> {
      const id = raw?.CallSid ?? raw?.callsid ?? raw?.Sid; if (!id) return [];
      const status = String(raw.Status ?? raw.status ?? '').toLowerCase().replace(/_/g, '-');
      const dur = Number(raw.ConversationDuration ?? raw.Duration ?? raw.duration ?? NaN);
      const out: CanonicalEvent[] = [];
      if (['in-progress', 'answered'].includes(status)) out.push({ kind: 'CallEvent', callRef: String(id), state: 'answered' });
      else if (status === 'ringing') out.push({ kind: 'CallEvent', callRef: String(id), state: 'ringing' });
      else if (['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
        out.push({ kind: 'CallEvent', callRef: String(id), state: 'ended', outcome: status === 'no-answer' ? 'no_answer' : (status as any), durationS: Number.isFinite(dur) ? dur : undefined });
      }
      if (raw.RecordingUrl) out.push({ kind: 'CallEvent', callRef: String(id), state: 'recording_ready', recordingUrl: String(raw.RecordingUrl) });
      return out;
    },
  };
}
