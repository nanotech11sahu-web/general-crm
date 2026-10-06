import { AuthRevokedError, createHttp, HttpError, verifyHmacSha256, type BackfillLead, type CanonicalEvent, type Connector, type ConnectorContext, type FetchLike, type RawRequest } from '@leaddesk/connectors-core';

export interface MetaEnv { appId: string; appSecret: string; verifyToken: string; graphVersion?: string; fetch?: FetchLike }

const LEAD_FIELDS = 'created_time,id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data';
export const REQUIRED_SCOPES = ['leads_retrieval', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement'];

const h = (req: RawRequest, name: string) => { const v = req.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };

/** Meta error codes that mean the grant itself is gone (user changed password, removed app, token expired). */
function isAuthError(e: unknown) {
  if (!(e instanceof HttpError)) return false;
  const err = (e.body as any)?.error;
  return err?.code === 190 || err?.type === 'OAuthException' && [102, 190, 463, 467].includes(err?.code) || e.status === 401;
}

/** Meta's `field_data` -> flat canonical keys the intake mapper understands. */
export function canonicalFields(lead: any, pageId?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw: Record<string, string> = {};
  for (const f of lead.field_data ?? []) raw[f.name] = (f.values ?? []).join(', ');
  const pick = (...keys: string[]) => keys.map((k) => raw[k]).find(Boolean);
  const name = pick('full_name') ?? [pick('first_name'), pick('last_name')].filter(Boolean).join(' ');
  if (name) out.name = name;
  const phone = pick('phone_number', 'phone', 'mobile_number', 'whatsapp_number'); if (phone) out.phone = phone;
  const email = pick('email', 'work_email'); if (email) out.email = email;
  const city = pick('city', 'location'); if (city) out.city = city;
  if (lead.campaign_name) out.campaign = lead.campaign_name;
  if (lead.adset_name) out.adSet = lead.adset_name;
  if (lead.ad_name) out.ad = lead.ad_name;
  if (lead.form_id) out.formName = String(lead.form_id);
  out.metaLeadId = String(lead.id);
  if (pageId) out.pageId = pageId;
  // everything else the lead answered stays visible (activity payload), never silently dropped
  for (const [k, v] of Object.entries(raw)) if (!['full_name', 'first_name', 'last_name', 'phone_number', 'phone', 'mobile_number', 'whatsapp_number', 'email', 'work_email', 'city', 'location'].includes(k)) out[`answer.${k}`] = v;
  return out;
}

export function createMetaLeadAds(env: MetaEnv): Connector {
  const v = env.graphVersion ?? 'v26.0';
  const base = `https://graph.facebook.com/${v}`;
  const http = createHttp({ allowedHosts: ['graph.facebook.com'], fetch: env.fetch });
  const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const get = async (path: string, params: Record<string, string>) => {
    try { return await http.json<any>(`${base}/${path}?${qs(params)}`); }
    catch (e) { if (isAuthError(e)) throw new AuthRevokedError((e as HttpError).message); throw e; }
  };
  const post = async (path: string, params: Record<string, string>) => {
    try { return await http.json<any>(`${base}/${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs(params) }); }
    catch (e) { if (isAuthError(e)) throw new AuthRevokedError((e as HttpError).message); throw e; }
  };
  const appToken = `${env.appId}|${env.appSecret}`;
  const pageTokens = (c: Record<string, string>): Record<string, string> => { try { return JSON.parse(c.pageTokens ?? '{}'); } catch { return {}; } };
  const pageIds = (ctx: ConnectorContext) => ((ctx.config.pageIds as string[] | undefined) ?? []);

  async function debug(userToken: string) {
    const d = (await get('debug_token', { input_token: userToken, access_token: appToken })).data;
    return { valid: !!d?.is_valid, scopes: (d?.scopes ?? []) as string[], expiresAt: d?.expires_at ? new Date(d.expires_at * 1000) : null, appId: String(d?.app_id ?? '') };
  }
  async function listPages(userToken: string) {
    const pages: { id: string; name: string; access_token: string }[] = [];
    let next: string | undefined = `${base}/me/accounts?${qs({ access_token: userToken, fields: 'id,name,access_token', limit: '100' })}`;
    for (let i = 0; next && i < 10; i++) { const r: any = await http.json(next).catch((e) => { if (isAuthError(e)) throw new AuthRevokedError(e.message); throw e; }); pages.push(...(r.data ?? [])); next = r.paging?.next; }
    return pages;
  }

  return {
    manifest: {
      id: 'meta-leadads', category: 'lead_source', displayName: 'Meta Lead Ads (Facebook & Instagram)', logo: 'meta', docsUrl: 'https://developers.facebook.com/docs/marketing-api/guides/lead-ads/',
      auth: { type: 'oauth2' },
      credentialFields: [{ key: 'userToken', label: 'Long-lived user access token', type: 'secret', required: true, help: 'Use “Connect with Meta”; only paste a token for advanced setups.' }],
      configFields: [],
      capabilities: ['lead.subscribe', 'lead.backfill'],
      webhook: {
        appLevel: true,
        secretKey: 'appSecret',
        verify: (req, secret) => verifyHmacSha256(req.rawBody, secret || env.appSecret, h(req, 'x-hub-signature-256')),
        // each stored inbox row is one leadgen change, so the id is the leadgen_id
        extractEventId: (req) => { try { return String(JSON.parse(req.rawBody.toString('utf8'))?.leadgen_id ?? ''); } catch { return ''; } },
      },
    },

    async verify(ctx) {
      const { userToken } = await ctx.credentials();
      const d = await debug(userToken);
      if (!d.valid) return { ok: false, detail: 'Token is not valid. Reconnect with Meta.' };
      if (d.appId && d.appId !== env.appId) return { ok: false, detail: 'Token belongs to a different app' };
      const missing = REQUIRED_SCOPES.filter((s) => !d.scopes.includes(s));
      if (missing.length) return { ok: false, detail: `Missing permissions: ${missing.join(', ')}` };
      const pages = await listPages(userToken);
      if (!pages.length) return { ok: false, detail: 'No Facebook Pages found for this account' };
      return {
        ok: true,
        patch: {
          credentials: { userToken, pageTokens: JSON.stringify(Object.fromEntries(pages.map((p) => [p.id, p.access_token]))) },
          config: { pages: pages.map((p) => ({ id: p.id, name: p.name })), pageIds: pages.map((p) => p.id) },
          oauthExpiresAt: d.expiresAt,
        },
      };
    },

    async health(ctx) {
      const { userToken } = await ctx.credentials();
      await get('me', { access_token: userToken, fields: 'id' });
      return { ok: true };
    },

    async refresh(ctx) {
      const creds = await ctx.credentials();
      const r = await get('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: env.appId, client_secret: env.appSecret, fb_exchange_token: creds.userToken });
      const d = await debug(r.access_token);
      const pages = await listPages(r.access_token);
      return {
        credentials: { userToken: r.access_token, pageTokens: JSON.stringify(Object.fromEntries(pages.map((p) => [p.id, p.access_token]))) },
        expiresAt: d.expiresAt ?? new Date(Date.now() + (r.expires_in ?? 5_184_000) * 1000),
      };
    },

    /** Meta silently drops page subscriptions; verify each page lists our app + `leadgen`, re-create if not. */
    async ensureSubscribed(ctx) {
      const creds = await ctx.credentials(); const tokens = pageTokens(creds);
      let fixed = 0; const problems: string[] = [];
      for (const id of pageIds(ctx)) {
        const token = tokens[id];
        if (!token) { problems.push(`no token for page ${id}`); continue; }
        const r = await get(`${id}/subscribed_apps`, { access_token: token });
        const mine = (r.data ?? []).find((a: any) => String(a.id) === env.appId);
        const ok = mine && (mine.subscribed_fields ?? []).includes('leadgen');
        if (!ok) {
          const res = await post(`${id}/subscribed_apps`, { access_token: token, subscribed_fields: 'leadgen' });
          if (res.success) fixed++; else problems.push(`could not subscribe page ${id}`);
        }
      }
      return { ok: problems.length === 0, fixed: fixed > 0, detail: [fixed ? `re-subscribed ${fixed} page(s)` : '', ...problems].filter(Boolean).join('; ') || undefined };
    },

    async parseWebhook(raw: any, ctx): Promise<CanonicalEvent[]> {
      if (raw?._backfill) {            // already-fetched lead stored by the reconcile job
        const { id, ...fields } = raw;
        delete (fields as Record<string, unknown>)._backfill;
        return [{ kind: 'LeadReceived', externalRef: String(id), fields }];
      }
      const leadgenId = raw?.leadgen_id;
      if (!leadgenId) throw new Error('leadgen_id missing from webhook');
      if (!ctx) throw new Error('connection context required to fetch lead');
      const creds = await ctx.credentials();
      const token = pageTokens(creds)[String(raw.page_id)];
      if (!token) throw new Error(`Page ${raw.page_id} is not connected`);
      const lead = await get(String(leadgenId), { access_token: token, fields: LEAD_FIELDS });
      return [{ kind: 'LeadReceived', externalRef: String(leadgenId), fields: canonicalFields(lead, String(raw.page_id)) }];
    },

    async *backfill(ctx, since): AsyncIterable<BackfillLead> {
      const creds = await ctx.credentials(); const tokens = pageTokens(creds);
      for (const pageId of pageIds(ctx)) {
        const token = tokens[pageId]; if (!token) continue;
        let forms: any = await get(`${pageId}/leadgen_forms`, { access_token: token, fields: 'id,name', limit: '100' });
        for (let fp = 0; forms && fp < 20; fp++) {
          for (const form of forms.data ?? []) {
            let page: any = await get(`${form.id}/leads`, { access_token: token, fields: LEAD_FIELDS, limit: '100', filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) }]) });
            for (let lp = 0; page && lp < 200; lp++) {
              for (const lead of page.data ?? []) yield { externalRef: String(lead.id), createdAt: lead.created_time ? new Date(lead.created_time) : undefined, fields: { ...canonicalFields(lead, pageId), formName: form.name ?? lead.form_id, _backfill: true } };
              page = page.paging?.next ? await http.json(page.paging.next).catch((e: any) => { if (isAuthError(e)) throw new AuthRevokedError(e.message); throw e; }) : null;
            }
          }
          forms = forms.paging?.next ? await http.json(forms.paging.next).catch((e: any) => { if (isAuthError(e)) throw new AuthRevokedError(e.message); throw e; }) : null;
        }
      }
    },
  };
}

/** GET /hooks/meta-leadads?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… */
export function metaChallenge(query: Record<string, string | undefined>, verifyToken: string): string | null {
  return query['hub.mode'] === 'subscribe' && query['hub.verify_token'] && query['hub.verify_token'] === verifyToken ? (query['hub.challenge'] ?? null) : null;
}

/** Split an app-level webhook body into one change per lead. */
export function leadgenChanges(body: any): { pageId: string; value: any }[] {
  const out: { pageId: string; value: any }[] = [];
  if (body?.object !== 'page') return out;
  for (const entry of body.entry ?? []) for (const ch of entry.changes ?? []) if (ch.field === 'leadgen' && ch.value?.leadgen_id) out.push({ pageId: String(ch.value.page_id ?? entry.id), value: ch.value });
  return out;
}
