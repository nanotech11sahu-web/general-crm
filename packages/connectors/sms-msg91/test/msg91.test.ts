import { describe, expect, it } from 'vitest';
import { MessageRejectedError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { createMsg91Sms } from '../src';

const ctx = (): ConnectorContext => ({ tenantId: 't', connectionId: 'c', config: { senderId: 'ACMEIN', dltEntityId: '1101234567890' }, credentials: async () => ({ authKey: 'AUTHKEY1234567890ab', webhookToken: 'whtok' }) });
const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });

describe('msg91 sms connector (documented-shape fixtures; not verified live)', () => {
  it('maps the template + variables onto the Flow API and returns the request id', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => { seen = { url, headers: init?.headers, body: JSON.parse(init!.body!) }; return resp(200, { type: 'success', message: 'req-123' }); };
    const r = await createMsg91Sms({ fetch: f }).send!(ctx(), { to: '+919812345678', channel: 'sms', template: { name: 'welcome', language: 'en', variables: ['Asha', 'Skyline'], providerTemplateId: 'tpl-1', dltTemplateId: '1107' } });
    expect(r).toEqual({ providerMessageId: 'req-123' });
    expect(seen.url).toBe('https://control.msg91.com/api/v5/flow');
    expect(seen.headers.authkey).toBe('AUTHKEY1234567890ab');
    expect(seen.body).toEqual({ template_id: 'tpl-1', short_url: '0', recipients: [{ mobiles: '919812345678', VAR1: 'Asha', VAR2: 'Skyline' }] });
  });
  it('refuses without a provider template id; maps provider refusals; 5xx stays retryable', async () => {
    const c = createMsg91Sms({ fetch: async () => resp(200, { type: 'error', message: 'Template not mapped' }) });
    await expect(c.send!(ctx(), { to: '+919812345678', channel: 'sms', template: { name: 'x', language: 'en', variables: [] } })).rejects.toBeInstanceOf(MessageRejectedError);
    await expect(c.send!(ctx(), { to: '+919812345678', channel: 'sms', template: { name: 'x', language: 'en', variables: [], providerTemplateId: 't' } })).rejects.toThrow('Template not mapped');
    const down = createMsg91Sms({ fetch: async () => resp(503, {}) });
    const e = await down.send!(ctx(), { to: '+919812345678', channel: 'sms', template: { name: 'x', language: 'en', variables: [], providerTemplateId: 't' } }).catch((x) => x);
    expect(e).not.toBeInstanceOf(MessageRejectedError);
  });
  it('verify is offline and honest; webhook needs the shared token; delivery reports and replies parse', async () => {
    const c = createMsg91Sms();
    expect(await c.verify(ctx())).toMatchObject({ ok: true, detail: expect.stringMatching(/test SMS/) });
    expect((await c.verify({ ...ctx(), credentials: async () => ({ authKey: 'bad' }) })).ok).toBe(false);
    const w = c.manifest.webhook!;
    const raw = Buffer.from('{}');
    expect(w.verify({ headers: {}, rawBody: raw, query: { token: 'whtok' } }, 'whtok')).toBe(true);
    expect(w.verify({ headers: { 'x-webhook-token': 'whtok' }, rawBody: raw }, 'whtok')).toBe(true);
    expect(w.verify({ headers: {}, rawBody: raw, query: { token: 'nope' } }, 'whtok')).toBe(false);
    expect(w.verify({ headers: {}, rawBody: raw }, 'whtok')).toBe(false);
    expect(w.extractEventId({ headers: {}, rawBody: Buffer.from('[{"request_id":"r1","status":"1"}]') })).toBe('r1:1');
    const ev = await c.parseWebhook!([{ request_id: 'r1', status: '1' }, { request_id: 'r2', status: '2', description: 'DND' }, { requestId: 'r3', status: 'queued' }, { mobile: '919812345678', text: 'STOP', date: '2026-03-10T05:00:00Z' }, null]);
    expect(ev.map((e) => (e as any).status ?? e.kind)).toEqual(['delivered', 'failed', 'sent', 'InboundMessage']);
    expect(ev[1]).toMatchObject({ error: 'DND' });
    expect(ev[3]).toMatchObject({ from: '+919812345678', body: 'STOP' });
  });
});
