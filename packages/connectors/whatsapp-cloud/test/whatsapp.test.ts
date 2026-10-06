import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuthRevokedError, MessageRejectedError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { createWhatsAppCloud, exchangeEmbeddedSignupCode, splitWhatsAppWebhook, whatsappChallenge } from '../src';

/** Documented-shape fixtures of Cloud API responses/webhooks; NOT recordings from a live number. */
const ok = (b: any) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
const err = (status: number, error: any) => ({ ok: false, status, text: async () => JSON.stringify({ error }) });
const ctx = (config: any = { wabaId: '1234567', phoneNumberId: '7654321' }): ConnectorContext => ({ tenantId: 't', connectionId: 'c', config, credentials: async () => ({ accessToken: 'tok' }) });

function fake(h: (path: string, init: any) => any): { fetch: FetchLike; calls: { path: string; method: string; body: any }[] } {
  const calls: { path: string; method: string; body: any }[] = [];
  return { calls, fetch: async (url, init) => { const u = new URL(url); const path = u.pathname.replace(/^\/v26\.0\//, '') + u.search; calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined }); return h(path, init); } };
}
const mk = (f: FetchLike) => createWhatsAppCloud({ appId: 'APP', appSecret: 'sec', verifyToken: 'vt', fetch: f });

describe('whatsapp cloud connector (fixtures)', () => {
  it('verify reads the number; health flags a RED quality rating', async () => {
    const f = fake((p) => p.startsWith('7654321') ? ok({ display_phone_number: '+91 98123 45678', verified_name: 'Acme', quality_rating: 'GREEN' }) : ok({ name: 'WABA' }));
    expect(await mk(f.fetch).verify(ctx())).toMatchObject({ ok: true, patch: { config: { displayPhone: '+91 98123 45678', verifiedName: 'Acme' } } });
    const red = fake(() => ok({ id: '1', quality_rating: 'RED' }));
    expect((await mk(red.fetch).health(ctx())).ok).toBe(false);
  });
  it('sends free text and templates with the right payloads (number without +)', async () => {
    const f = fake(() => ok({ messages: [{ id: 'wamid.AAA' }] }));
    const c = mk(f.fetch);
    expect(await c.send!(ctx(), { to: '+919812345678', channel: 'whatsapp', body: 'Hello there' })).toEqual({ providerMessageId: 'wamid.AAA' });
    expect(f.calls[0]).toMatchObject({ path: '7654321/messages', method: 'POST', body: { messaging_product: 'whatsapp', to: '919812345678', type: 'text', text: { body: 'Hello there' } } });
    await c.send!(ctx(), { to: '+919812345678', channel: 'whatsapp', template: { name: 'welcome', language: 'en', variables: ['Asha', 'Skyline'] } });
    expect(f.calls[1].body.template).toEqual({ name: 'welcome', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'Skyline' }] }] });
    await c.send!(ctx(), { to: '+919812345678', channel: 'whatsapp', template: { name: 'plain', language: 'en', variables: [] } });
    expect(f.calls[2].body.template.components).toBeUndefined();
    await expect(c.send!(ctx(), { to: '+919812345678', channel: 'whatsapp' })).rejects.toBeInstanceOf(MessageRejectedError);
  });
  it('maps provider refusals to platform reasons and revoked tokens to AuthRevokedError', async () => {
    const code = async (c: number) => mk(fake(() => err(400, { code: c, message: 'm' })).fetch).send!(ctx(), { to: '+919812345678', channel: 'whatsapp', body: 'x' }).catch((e) => e);
    expect(await code(131047)).toMatchObject({ code: 'window_closed' });
    expect(await code(131026)).toMatchObject({ code: 'recipient_unreachable' });
    expect(await code(132001)).toMatchObject({ code: 'template_rejected' });
    await expect(mk(fake(() => err(401, { code: 190, message: 'expired' })).fetch).health(ctx())).rejects.toBeInstanceOf(AuthRevokedError);
    // a 500 is a transport problem, not a refusal: it surfaces as a retryable error
    const e = await mk(fake(() => err(500, { code: 1, message: 'boom' })).fetch).send!(ctx(), { to: '+919812345678', channel: 'whatsapp', body: 'x' }).catch((x) => x);
    expect(e).not.toBeInstanceOf(MessageRejectedError);
  });
  it('syncs templates (paged, stays on the Graph host), submits drafts, and re-subscribes a missing app', async () => {
    const f = fake((p) => {
      if (p.includes('message_templates') && !p.includes('after')) return ok({ data: [{ id: 't1', name: 'welcome', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}' }] }], paging: { next: 'https://graph.facebook.com/v26.0/1234567/message_templates?after=abc' } });
      if (p.includes('after=abc')) return ok({ data: [{ id: 't2', name: 'promo', language: 'en', status: 'REJECTED', rejected_reason: 'INCORRECT_CATEGORY', components: [] }] });
      return ok({});
    });
    const t = await mk(f.fetch).syncTemplates!(ctx());
    expect(t).toEqual([
      { providerTemplateId: 't1', name: 'welcome', language: 'en', status: 'approved', category: 'utility', body: 'Hi {{1}}', reason: undefined },
      { providerTemplateId: 't2', name: 'promo', language: 'en', status: 'rejected', category: '', body: undefined, reason: 'INCORRECT_CATEGORY' },
    ]);
    const s = fake(() => ok({ id: 'new1', status: 'PENDING' }));
    expect(await mk(s.fetch).submitTemplate!(ctx(), { name: 'hello', language: 'en', category: 'utility', body: 'Hi {{1}}', sampleValues: ['Asha'] })).toEqual({ providerTemplateId: 'new1', status: 'pending' });
    expect(s.calls[0].body).toMatchObject({ category: 'UTILITY', components: [{ type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Asha']] } }] });
    const sub = fake((p, init) => init?.method === 'POST' ? ok({ success: true }) : ok({ data: [] }));
    expect(await mk(sub.fetch).ensureSubscribed!(ctx())).toMatchObject({ ok: true, fixed: true });
    expect(await mk(fake(() => ok({ data: [{ id: 'APP' }] })).fetch).ensureSubscribed!(ctx())).toMatchObject({ ok: true, fixed: false });
  });
  it('splits an app-level webhook into routable rows and parses each into canonical events', async () => {
    const body = { object: 'whatsapp_business_account', entry: [{ id: '1234567', changes: [
      { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '7654321', display_phone_number: '91981' }, contacts: [{ wa_id: '919812345678', profile: { name: 'Anita' } }],
        messages: [{ from: '919812345678', id: 'wamid.IN1', timestamp: '1773120000', type: 'text', text: { body: 'STOP' } }, { from: '919812345678', id: 'wamid.IN2', timestamp: '1773120001', type: 'image', image: { id: 'm1', caption: 'photo' } }],
        statuses: [{ id: 'wamid.OUT1', status: 'delivered', timestamp: '1773120002', recipient_id: '919812345678' }, { id: 'wamid.OUT2', status: 'failed', errors: [{ code: 131026, title: 'Receiver is incapable of receiving this message' }] }] } },
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 't1', message_template_name: 'welcome', message_template_language: 'en', reason: 'NONE' } },
      { field: 'account_alerts', value: {} },
    ] }] };
    const rows = splitWhatsAppWebhook(body);
    expect(rows.map((r) => r.eventId)).toEqual(['wamid.IN1', 'wamid.IN2', 'status:wamid.OUT1:delivered', 'status:wamid.OUT2:failed', 'tpl:t1:APPROVED']);
    expect(rows[0].route).toEqual({ phoneNumberId: '7654321' }); expect(rows[4].route).toEqual({ wabaId: '1234567' });
    const c = mk(fake(() => ok({})).fetch);
    const parsed = (await Promise.all(rows.map((r) => c.parseWebhook!(r.payload)))).flat();
    expect(parsed[0]).toMatchObject({ kind: 'InboundMessage', from: '+919812345678', body: 'STOP', providerMessageId: 'wamid.IN1', profileName: 'Anita' });
    expect((parsed[0] as any).timestamp).toEqual(new Date(1773120000 * 1000));
    expect(parsed[1]).toMatchObject({ mediaType: 'image', body: 'photo' });
    expect(parsed[2]).toMatchObject({ kind: 'MessageStatus', status: 'delivered' });
    expect(parsed[3]).toMatchObject({ status: 'failed', error: 'Receiver is incapable of receiving this message' });
    expect(parsed[4]).toMatchObject({ kind: 'TemplateStatus', status: 'approved', name: 'welcome', reason: undefined });
    expect(splitWhatsAppWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(await c.parseWebhook!({ kind: 'status', id: 'x', status: 'deleted' })).toEqual([]);
  });
  it('signature uses the app secret; handshake needs the token; embedded signup code exchange', async () => {
    const c = mk(fake(() => ok({})).fetch);
    const raw = Buffer.from('{"a":1}'); const sig = 'sha256=' + createHmac('sha256', 'sec').update(raw).digest('hex');
    expect(c.manifest.webhook!.verify({ headers: { 'x-hub-signature-256': sig }, rawBody: raw }, '')).toBe(true);
    expect(c.manifest.webhook!.verify({ headers: { 'x-hub-signature-256': sig }, rawBody: Buffer.from('x') }, '')).toBe(false);
    expect(whatsappChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '9' }, 'vt')).toBe('9');
    expect(whatsappChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'no', 'hub.challenge': '9' }, 'vt')).toBeNull();
    const f = fake(() => ok({ access_token: 'biz-token' }));
    expect(await exchangeEmbeddedSignupCode({ appId: 'APP', appSecret: 'sec', verifyToken: '', fetch: f.fetch }, 'code1')).toEqual({ accessToken: 'biz-token' });
    expect(f.calls[0].path).toContain('code=code1');
  });
});
