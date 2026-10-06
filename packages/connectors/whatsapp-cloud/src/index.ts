import { AuthRevokedError, createHttp, HttpError, MessageRejectedError, verifyHmacSha256, type CanonicalEvent, type Connector, type ConnectorContext, type FetchLike, type OutboundMessage, type ProviderTemplate, type RawRequest } from '@leaddesk/connectors-core';

export interface WhatsAppEnv { appId: string; appSecret: string; verifyToken: string; graphVersion?: string; fetch?: FetchLike }

const h = (req: RawRequest, name: string) => { const v = req.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
const digits = (e164: string) => e164.replace(/\D/g, '');

/** Cloud API error codes that mean the grant is gone. */
const isAuth = (e: unknown) => e instanceof HttpError && ((e.body as any)?.error?.code === 190 || e.status === 401);

/** Map a Graph error to a platform-level reason so the UI can say something useful. */
function rejection(e: HttpError): MessageRejectedError | null {
  const err = (e.body as any)?.error; const code = Number(err?.code); const sub = Number(err?.error_subcode);
  if (code === 131047) return new MessageRejectedError('window_closed', 'The 24-hour window is closed: use an approved template');
  if (code === 131026) return new MessageRejectedError('recipient_unreachable', 'This number is not on WhatsApp or cannot receive the message');
  if (code === 132001 || code === 132000 || code === 132012 || sub === 2494073) return new MessageRejectedError('template_rejected', err?.message ?? 'Template problem');
  if (e.status === 400 && err) return new MessageRejectedError('other', err.error_user_msg ?? err.message ?? 'Message rejected');
  return null;
}

export function createWhatsAppCloud(env: WhatsAppEnv): Connector {
  const base = `https://graph.facebook.com/${env.graphVersion ?? 'v26.0'}`;
  const http = createHttp({ allowedHosts: ['graph.facebook.com'], fetch: env.fetch });
  const auth = async (ctx: ConnectorContext) => ({ authorization: `Bearer ${(await ctx.credentials()).accessToken}` });
  const cfg = (ctx: ConnectorContext) => ({ waba: String(ctx.config.wabaId ?? ''), phone: String(ctx.config.phoneNumberId ?? '') });
  const call = async <T = any>(ctx: ConnectorContext, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    try {
      return await http.json<T>(`${base}/${path}`, { method: init.method, headers: { ...(await auth(ctx)), ...(init.body ? { 'content-type': 'application/json' } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    } catch (e) { if (isAuth(e)) throw new AuthRevokedError((e as HttpError).message); throw e; }
  };

  return {
    manifest: {
      id: 'whatsapp-cloud', category: 'whatsapp', displayName: 'WhatsApp Business (Cloud API)', logo: 'whatsapp', docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
      auth: { type: 'oauth2' },
      credentialFields: [{ key: 'accessToken', label: 'Access token', type: 'secret', required: true, help: 'Use “Connect WhatsApp” (Embedded Signup). Advanced: paste a system-user token with whatsapp_business_messaging and whatsapp_business_management.' }],
      configFields: [
        { key: 'wabaId', label: 'WhatsApp Business Account ID', type: 'text', required: true, pattern: '^\\d{5,30}$' },
        { key: 'phoneNumberId', label: 'Phone number ID', type: 'text', required: true, pattern: '^\\d{5,30}$' },
      ],
      capabilities: ['msg.send', 'msg.inbound', 'msg.status', 'msg.templates'],
      webhook: { appLevel: true, secretKey: 'appSecret', verify: (req, secret) => verifyHmacSha256(req.rawBody, secret || env.appSecret, h(req, 'x-hub-signature-256')), extractEventId: () => '' },
    },

    async verify(ctx) {
      const { waba, phone } = cfg(ctx);
      const p = await call(ctx, `${phone}?fields=display_phone_number,verified_name,quality_rating`);
      await call(ctx, `${waba}?fields=name`);
      return { ok: true, patch: { config: { displayPhone: p.display_phone_number, verifiedName: p.verified_name, quality: p.quality_rating } } };
    },
    async health(ctx) {
      const { phone } = cfg(ctx);
      const p = await call(ctx, `${phone}?fields=id,quality_rating`);
      return p.quality_rating === 'RED' ? { ok: false, detail: 'Phone number quality rating is RED: sending may be limited by WhatsApp' } : { ok: true };
    },
    async ensureSubscribed(ctx) {
      const { waba } = cfg(ctx);
      const r = await call(ctx, `${waba}/subscribed_apps`);
      if ((r.data ?? []).some((a: any) => String(a.whatsapp_business_api_data?.id ?? a.id) === env.appId || a.id === env.appId)) return { ok: true, fixed: false };
      const res = await call(ctx, `${waba}/subscribed_apps`, { method: 'POST' });
      return res.success ? { ok: true, fixed: true, detail: 'subscribed this app to the WhatsApp Business Account' } : { ok: false, detail: 'could not subscribe the app to the WhatsApp Business Account' };
    },

    async send(ctx, msg: OutboundMessage) {
      const { phone } = cfg(ctx);
      const payload: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to: digits(msg.to) };
      if (msg.template) {
        payload.type = 'template';
        payload.template = { name: msg.template.name, language: { code: msg.template.language }, ...(msg.template.variables.length ? { components: [{ type: 'body', parameters: msg.template.variables.map((text) => ({ type: 'text', text })) }] } : {}) };
      } else if (msg.body) {
        payload.type = 'text'; payload.text = { body: msg.body, preview_url: false };
      } else throw new MessageRejectedError('other', 'Empty message');
      try {
        const r = await call(ctx, `${phone}/messages`, { method: 'POST', body: payload });
        const id = r.messages?.[0]?.id;
        if (!id) throw new Error('WhatsApp did not return a message id');
        return { providerMessageId: String(id) };
      } catch (e) { const rej = e instanceof HttpError ? rejection(e) : null; if (rej) throw rej; throw e; }
    },

    async syncTemplates(ctx): Promise<ProviderTemplate[]> {
      const { waba } = cfg(ctx);
      const out: ProviderTemplate[] = [];
      let path: string | null = `${waba}/message_templates?limit=100&fields=id,name,language,status,category,components,rejected_reason`;
      for (let i = 0; path && i < 20; i++) {
        const r: any = await call(ctx, path);
        for (const t of r.data ?? []) out.push({ providerTemplateId: String(t.id), name: t.name, language: t.language, category: String(t.category ?? '').toLowerCase(), status: mapStatus(t.status), body: t.components?.find((c: any) => c.type === 'BODY')?.text, reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : undefined });
        const next: string | undefined = r.paging?.next;
        path = next ? next.replace(`${base}/`, '') : null; // stays on the allow-listed host
      }
      return out;
    },

    async submitTemplate(ctx, t) {
      const { waba } = cfg(ctx);
      const r = await call(ctx, `${waba}/message_templates`, { method: 'POST', body: { name: t.name, language: t.language, category: t.category.toUpperCase(), components: [{ type: 'BODY', text: t.body, ...(t.sampleValues.length ? { example: { body_text: [t.sampleValues] } } : {}) }] } });
      return { providerTemplateId: String(r.id), status: mapStatus(r.status ?? 'PENDING') };
    },

    /** One stored row = one message, status or template event (the ingress splits the app-level payload). */
    async parseWebhook(raw: any): Promise<CanonicalEvent[]> {
      if (raw?.kind === 'message') {
        const m = raw;
        const body = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : m[m.type]?.caption ?? '';
        return [{ kind: 'InboundMessage', from: `+${digits(String(m.from))}`, providerMessageId: String(m.id), body: String(body ?? ''), timestamp: new Date(Number(m.timestamp) * 1000), profileName: m.profileName, mediaType: ['text', 'button', 'interactive'].includes(m.type) ? undefined : m.type }];
      }
      if (raw?.kind === 'status') {
        const st = String(raw.status);
        if (!['sent', 'delivered', 'read', 'failed'].includes(st)) return [];
        return [{ kind: 'MessageStatus', providerMessageId: String(raw.id), status: st as any, error: st === 'failed' ? String(raw.errors?.[0]?.title ?? raw.errors?.[0]?.message ?? 'failed') : undefined }];
      }
      if (raw?.kind === 'template') {
        return [{ kind: 'TemplateStatus', providerTemplateId: raw.message_template_id ? String(raw.message_template_id) : undefined, name: raw.message_template_name, language: raw.message_template_language, status: mapStatus(raw.event), reason: raw.reason && raw.reason !== 'NONE' ? raw.reason : undefined }];
      }
      return [];
    },
  };
}

function mapStatus(s: string): 'approved' | 'rejected' | 'pending' {
  const v = String(s).toUpperCase();
  if (v === 'APPROVED') return 'approved';
  if (v === 'REJECTED' || v === 'DISABLED' || v === 'PAUSED') return 'rejected';
  return 'pending';
}

/**
 * Split an app-level WhatsApp webhook body into one stored row per message / status / template event,
 * each tagged with how to route it (phone_number_id for messages+statuses, waba id for templates).
 */
export function splitWhatsAppWebhook(body: any): { route: { phoneNumberId?: string; wabaId?: string }; eventId: string; payload: Record<string, unknown> }[] {
  const out: ReturnType<typeof splitWhatsAppWebhook> = [];
  if (body?.object !== 'whatsapp_business_account') return out;
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    if (ch.field === 'messages') {
      const phoneNumberId = String(v.metadata?.phone_number_id ?? '');
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? '')]));
      for (const m of v.messages ?? []) out.push({ route: { phoneNumberId }, eventId: String(m.id), payload: { ...m, kind: 'message', phone_number_id: phoneNumberId, profileName: names.get(String(m.from)) || undefined } });
      for (const s of v.statuses ?? []) out.push({ route: { phoneNumberId }, eventId: `status:${s.id}:${s.status}`, payload: { ...s, kind: 'status', phone_number_id: phoneNumberId } });
    } else if (ch.field === 'message_template_status_update') {
      out.push({ route: { wabaId: String(entry.id) }, eventId: `tpl:${v.message_template_id}:${v.event}`, payload: { ...v, kind: 'template' } });
    }
  }
  return out;
}

export function whatsappChallenge(query: Record<string, string | undefined>, token: string): string | null {
  return query['hub.mode'] === 'subscribe' && token && query['hub.verify_token'] === token ? (query['hub.challenge'] ?? null) : null;
}

/** Embedded Signup returns an authorization code; exchange it for a business token. */
export async function exchangeEmbeddedSignupCode(env: WhatsAppEnv, code: string): Promise<{ accessToken: string }> {
  const http = createHttp({ allowedHosts: ['graph.facebook.com'], fetch: env.fetch });
  const q = new URLSearchParams({ client_id: env.appId, client_secret: env.appSecret, code });
  const r = await http.json<any>(`https://graph.facebook.com/${env.graphVersion ?? 'v26.0'}/oauth/access_token?${q}`);
  if (!r.access_token) throw new Error('Meta did not return an access token');
  return { accessToken: String(r.access_token) };
}
