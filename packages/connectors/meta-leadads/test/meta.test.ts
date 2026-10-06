import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthRevokedError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { canonicalFields, createMetaLeadAds, leadgenChanges, metaChallenge } from '../src';

/** Recorded-shape fixtures of Graph API responses (documented shapes; NOT verified against the live API). */
const LEAD = { created_time: '2026-03-10T05:00:00+0000', id: '555001', ad_id: 'a1', ad_name: 'Ad One', adset_id: 's1', adset_name: 'Pune 25-40', campaign_id: 'c1', campaign_name: 'Summer Launch', form_id: 'f1',
  field_data: [{ name: 'full_name', values: ['Anita Desai'] }, { name: 'phone_number', values: ['+919812345678'] }, { name: 'email', values: ['anita@x.io'] }, { name: 'city', values: ['Pune'] }, { name: 'when_do_you_plan_to_buy?', values: ['this_month'] }] };

function graph(state: { subscribed: Record<string, string[]>; calls: string[]; invalidToken?: boolean; leads?: any[] }): FetchLike {
  return async (url, init) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/v26\.0\//, ''); const q = u.searchParams;
    state.calls.push(`${init?.method ?? 'GET'} ${path}`);
    const ok = (b: any) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
    const err = (status: number, error: any) => ({ ok: false, status, text: async () => JSON.stringify({ error }) });
    if (state.invalidToken && path !== 'debug_token') return err(400, { type: 'OAuthException', code: 190, message: 'Error validating access token: Session has expired' });
    if (path === 'debug_token') return ok({ data: { is_valid: true, app_id: 'APP1', expires_at: 1_900_000_000, scopes: ['leads_retrieval', 'pages_manage_metadata', 'pages_show_list', 'pages_read_engagement', 'ads_management'] } });
    if (path === 'me/accounts') return ok({ data: [{ id: 'P1', name: 'Acme Realty', access_token: 'ptok1' }, { id: 'P2', name: 'Acme Edu', access_token: 'ptok2' }] });
    if (path === 'me') return ok({ id: '1' });
    if (path === 'oauth/access_token') return ok({ access_token: 'new-long-lived', expires_in: 5184000 });
    const sub = path.match(/^(P\d)\/subscribed_apps$/);
    if (sub && !init?.method) return ok({ data: state.subscribed[sub[1]]?.length ? [{ id: 'APP1', subscribed_fields: state.subscribed[sub[1]] }] : [] });
    if (sub && init?.method === 'POST') { state.subscribed[sub[1]] = ['leadgen']; return ok({ success: true }); }
    if (path === '555001') return ok(LEAD);
    const forms = path.match(/^(P\d)\/leadgen_forms$/);
    if (forms) return ok({ data: forms[1] === 'P1' ? [{ id: 'F1', name: 'Site visit form' }] : [] });
    if (path === 'F1/leads') {
      if (!q.get('after')) return ok({ data: [state.leads![0]], paging: { next: `https://graph.facebook.com/v26.0/F1/leads?after=2&access_token=${q.get('access_token')}` } });
      return ok({ data: [state.leads![1]] });
    }
    return err(404, { code: 100, message: `unmocked ${path}` });
  };
}
const ctxFor = (config: any = { pageIds: ['P1', 'P2'] }, creds: any = { userToken: 'utok', pageTokens: JSON.stringify({ P1: 'ptok1', P2: 'ptok2' }) }): ConnectorContext =>
  ({ tenantId: 't', connectionId: 'c', config, credentials: async () => creds });
const mk = (state: any) => createMetaLeadAds({ appId: 'APP1', appSecret: 'shh', verifyToken: 'vt', fetch: graph(state) });

describe('meta lead ads connector (fixture-based)', () => {
  it('verify discovers pages, page tokens and token expiry', async () => {
    const r = await mk({ subscribed: {}, calls: [] }).verify(ctxFor({}, { userToken: 'utok' }));
    expect(r.ok).toBe(true);
    expect(r.patch!.config).toEqual({ pages: [{ id: 'P1', name: 'Acme Realty' }, { id: 'P2', name: 'Acme Edu' }], pageIds: ['P1', 'P2'] });
    expect(JSON.parse(r.patch!.credentials!.pageTokens)).toEqual({ P1: 'ptok1', P2: 'ptok2' });
    expect(r.patch!.oauthExpiresAt).toEqual(new Date(1_900_000_000 * 1000));
  });
  it('verify explains missing permissions and wrong app', async () => {
    const f: FetchLike = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(url.includes('debug_token') ? { data: { is_valid: true, app_id: 'APP1', scopes: ['pages_show_list'] } } : {}) });
    const r = await createMetaLeadAds({ appId: 'APP1', appSecret: 's', verifyToken: 'v', fetch: f }).verify(ctxFor({}, { userToken: 'x' }));
    expect(r.ok).toBe(false); expect(r.detail).toMatch(/leads_retrieval/);
  });
  it('maps an expired/revoked token (code 190) to AuthRevokedError on every call', async () => {
    const c = mk({ subscribed: {}, calls: [], invalidToken: true });
    await expect(c.health(ctxFor())).rejects.toBeInstanceOf(AuthRevokedError);
    await expect(c.ensureSubscribed!(ctxFor())).rejects.toBeInstanceOf(AuthRevokedError);
  });
  it('detects a silently dropped page subscription and re-creates it', async () => {
    const state = { subscribed: { P1: ['leadgen'] } as Record<string, string[]>, calls: [] as string[] };
    const r = await mk(state).ensureSubscribed!(ctxFor());
    expect(r).toMatchObject({ ok: true, fixed: true });
    expect(state.calls.filter((c) => c.startsWith('POST'))).toEqual(['POST P2/subscribed_apps']);
    expect(state.subscribed.P2).toEqual(['leadgen']);
    const again = await mk(state).ensureSubscribed!(ctxFor());
    expect(again).toMatchObject({ ok: true, fixed: false });
  });
  it('fetches the full lead for a webhook and emits canonical fields incl. ad attribution', async () => {
    const ev = await mk({ subscribed: {}, calls: [] }).parseWebhook!({ leadgen_id: '555001', page_id: 'P1', form_id: 'f1' }, ctxFor());
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'LeadReceived', externalRef: '555001' });
    expect((ev[0] as any).fields).toMatchObject({ name: 'Anita Desai', phone: '+919812345678', email: 'anita@x.io', city: 'Pune', campaign: 'Summer Launch', adSet: 'Pune 25-40', ad: 'Ad One', metaLeadId: '555001', pageId: 'P1', 'answer.when_do_you_plan_to_buy?': 'this_month' });
    await expect(mk({ subscribed: {}, calls: [] }).parseWebhook!({ leadgen_id: '555001', page_id: 'PX' }, ctxFor())).rejects.toThrow(/not connected/);
    await expect(mk({ subscribed: {}, calls: [] }).parseWebhook!({ nothing: 1 }, ctxFor())).rejects.toThrow(/leadgen_id/);
  });
  it('re-parses stored backfill rows without calling the API', async () => {
    const state = { subscribed: {}, calls: [] as string[] };
    const ev = await mk(state).parseWebhook!({ _backfill: true, id: '9', name: 'B', phone: '9000000000' }, ctxFor());
    expect(ev[0]).toMatchObject({ externalRef: '9' });
    expect(state.calls).toHaveLength(0);
  });
  it('backfill walks pages -> forms -> paginated leads', async () => {
    const l2 = { ...LEAD, id: '555002', field_data: [{ name: 'full_name', values: ['Second'] }, { name: 'phone_number', values: ['9811111111'] }] };
    const out: any[] = [];
    for await (const l of mk({ subscribed: {}, calls: [], leads: [LEAD, l2] }).backfill!(ctxFor(), new Date('2026-03-01'))) out.push(l);
    expect(out.map((l) => l.externalRef)).toEqual(['555001', '555002']);
    expect(out[0].fields).toMatchObject({ formName: 'Site visit form', _backfill: true, name: 'Anita Desai' });
  });
  it('refresh exchanges the user token and re-reads page tokens', async () => {
    const r = await mk({ subscribed: {}, calls: [] }).refresh!(ctxFor());
    expect(r.credentials.userToken).toBe('new-long-lived');
    expect(JSON.parse(r.credentials.pageTokens).P1).toBe('ptok1');
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('blocks outbound requests to non-Graph hosts (hostile paging URL)', async () => {
    const f: FetchLike = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(url.includes('/leadgen_forms') ? { data: [{ id: 'F1' }] } : url.includes('F1/leads') ? { data: [], paging: { next: 'https://169.254.169.254/latest/meta-data' } } : { data: [] }) });
    const c = createMetaLeadAds({ appId: 'A', appSecret: 's', verifyToken: 'v', fetch: f });
    const out: any[] = [];
    await expect((async () => { for await (const l of c.backfill!(ctxFor(), new Date())) out.push(l); })()).rejects.toThrow(/Blocked outbound/);
  });
  it('webhook signature uses the app secret; challenge needs the verify token; changes are split per lead', () => {
    const c = mk({ subscribed: {}, calls: [] });
    const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
    const sig = 'sha256=' + createHmac('sha256', 'shh').update(body).digest('hex');
    expect(c.manifest.webhook!.verify({ headers: { 'x-hub-signature-256': sig }, rawBody: body }, 'shh')).toBe(true);
    expect(c.manifest.webhook!.verify({ headers: { 'x-hub-signature-256': sig }, rawBody: Buffer.from('tampered') }, 'shh')).toBe(false);
    expect(metaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '123' }, 'vt')).toBe('123');
    expect(metaChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '123' }, 'vt')).toBeNull();
    expect(leadgenChanges({ object: 'page', entry: [{ id: 'P1', changes: [{ field: 'leadgen', value: { leadgen_id: '1', page_id: 'P1' } }, { field: 'feed', value: {} }, { field: 'leadgen', value: { leadgen_id: '2', page_id: 'P1' } }] }] })).toHaveLength(2);
    expect(leadgenChanges({ object: 'user', entry: [] })).toEqual([]);
  });
  it('canonicalFields falls back to first+last name', () => {
    expect(canonicalFields({ id: '1', field_data: [{ name: 'first_name', values: ['A'] }, { name: 'last_name', values: ['B'] }] }).name).toBe('A B');
  });
});
