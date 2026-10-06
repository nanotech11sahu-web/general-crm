import { createHttp, HttpError, MessageRejectedError, verifyToken, type CanonicalEvent, type Connector, type ConnectorContext, type FetchLike, type OutboundMessage } from '@leaddesk/connectors-core';

export interface Msg91Env { fetch?: FetchLike }

const digits = (e164: string) => e164.replace(/\D/g, '');

/**
 * MSG91 Flow API v5 (DLT-compliant). The platform refuses to call `send` without an approved DLT template
 * (enforced upstream); this connector only maps the template + variables onto the provider call.
 * NOTE: request/response shapes follow MSG91's public docs and have not been verified against a live account.
 */
export function createMsg91Sms(env: Msg91Env = {}): Connector {
  const http = createHttp({ allowedHosts: ['control.msg91.com'], fetch: env.fetch });
  return {
    manifest: {
      id: 'sms-msg91', category: 'sms', displayName: 'MSG91 (SMS, India DLT)', logo: 'msg91', docsUrl: 'https://docs.msg91.com/',
      auth: { type: 'api_key' },
      credentialFields: [
        { key: 'authKey', label: 'Auth key', type: 'secret', required: true, help: 'MSG91 panel -> API Keys.' },
        { key: 'webhookToken', label: 'Webhook token', type: 'secret', required: true, generated: true, help: 'Append ?token=<this value> to the delivery-report URL you configure in MSG91.' },
      ],
      configFields: [
        { key: 'senderId', label: 'Sender ID (DLT header)', type: 'text', required: true, pattern: '^[A-Za-z0-9]{3,11}$' },
        { key: 'dltEntityId', label: 'DLT principal entity ID', type: 'text', required: true, pattern: '^\\d{8,30}$' },
      ],
      capabilities: ['msg.send', 'msg.status'],
      webhook: {
        secretKey: 'webhookToken',
        verify: (req, secret) => verifyToken(req, secret),
        extractEventId: (req) => { try { const b = JSON.parse(req.rawBody.toString('utf8')); const x = Array.isArray(b) ? b[0] : b; return `${x.request_id ?? x.requestId ?? x.id ?? ''}:${x.status ?? x.report_status ?? ''}`; } catch { return ''; } },
      },
    },

    // MSG91 has no documented side-effect-free credential check we can rely on, so this validates what we
    // can offline. The first real send (or the "send test SMS" button) is the true proof.
    async verify(ctx) {
      const { authKey } = await ctx.credentials();
      if (!/^[A-Za-z0-9]{16,}$/.test(authKey)) return { ok: false, detail: 'Auth key looks malformed' };
      return { ok: true, detail: 'Saved. Send a test SMS to confirm delivery.' };
    },
    async health() { return { ok: true }; },

    async send(ctx: ConnectorContext, msg: OutboundMessage) {
      if (!msg.template?.providerTemplateId) throw new MessageRejectedError('template_rejected', 'MSG91 needs the template id from your MSG91 panel');
      const { authKey } = await ctx.credentials();
      const recipient: Record<string, string> = { mobiles: digits(msg.to) };
      msg.template.variables.forEach((v, i) => { recipient[`VAR${i + 1}`] = v; });
      try {
        const r = await http.json<any>('https://control.msg91.com/api/v5/flow', { method: 'POST', headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ template_id: msg.template.providerTemplateId, short_url: '0', recipients: [recipient] }) });
        if (r.type && r.type !== 'success') throw new MessageRejectedError('other', String(r.message ?? 'MSG91 refused the message'));
        return { providerMessageId: String(r.message ?? r.request_id ?? '') };
      } catch (e) {
        if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) throw new MessageRejectedError(e.status === 401 || e.status === 403 ? 'other' : 'other', String((e.body as any)?.message ?? e.message));
        throw e;
      }
    },

    /** Delivery reports (and keyword replies if enabled) posted by MSG91. */
    async parseWebhook(raw: any): Promise<CanonicalEvent[]> {
      const items = Array.isArray(raw) ? raw : [raw];
      const out: CanonicalEvent[] = [];
      for (const x of items) {
        if (!x) continue;
        if (x.text || x.message_text) {
          const from = digits(String(x.mobile ?? x.sender ?? x.from ?? ''));
          if (from) out.push({ kind: 'InboundMessage', from: `+${from}`, providerMessageId: String(x.id ?? x.request_id ?? `${from}:${x.date ?? Date.now()}`), body: String(x.text ?? x.message_text), timestamp: new Date(x.date ?? Date.now()) });
          continue;
        }
        const id = x.request_id ?? x.requestId ?? x.id;
        if (!id) continue;
        const s = String(x.status ?? x.report_status ?? '').toLowerCase();
        const status = ['1', 'delivered', 'delivrd'].includes(s) ? 'delivered' : ['2', '9', '16', 'failed', 'undelivered', 'rejected', 'expired'].includes(s) ? 'failed' : 'sent';
        out.push({ kind: 'MessageStatus', providerMessageId: String(id), status, error: status === 'failed' ? String(x.description ?? x.reason ?? `delivery status ${s}`) : undefined });
      }
      return out;
    },
  };
}
