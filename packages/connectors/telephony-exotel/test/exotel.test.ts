import { describe, expect, it } from 'vitest';
import { AuthRevokedError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { createExotel } from '../src';

const ctx = (config: any = {}): ConnectorContext => ({ tenantId: 't', connectionId: 'c', config: { accountSid: 'acme1', callerId: '+918000000000', ...config }, credentials: async () => ({ apiKey: 'key', apiToken: 'tok', webhookToken: 'whtok' }) });
const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });

describe('exotel connector (documented-shape fixtures; not verified live)', () => {
  it('rings the agent first via Calls/connect with basic auth, recording and a terminal callback', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => { seen = { url, headers: init?.headers, body: new URLSearchParams(init!.body!) }; return resp(200, { Call: { Sid: 'call-sid-1', Status: 'queued' } }); };
    const r = await createExotel({ fetch: f }).startCall!(ctx(), { agentNumber: '+919900000001', leadNumber: '+919812345678', callbackUrl: 'https://hooks.example/hooks/telephony-exotel/pub?token=whtok', record: true });
    expect(r).toEqual({ providerCallId: 'call-sid-1' });
    expect(seen.url).toBe('https://api.exotel.com/v1/Accounts/acme1/Calls/connect.json');
    expect(seen.headers.authorization).toBe(`Basic ${Buffer.from('key:tok').toString('base64')}`);
    expect(Object.fromEntries(seen.body)).toMatchObject({ From: '+919900000001', To: '+919812345678', CallerId: '+918000000000', Record: 'true', RecordingChannels: 'dual', 'StatusCallbackEvents[0]': 'terminal' });
  });
  it('verify is read-only; wrong sid is explained; rejected credentials mean AuthRevokedError; hosts are allow-listed', async () => {
    let url = '';
    const c = createExotel({ fetch: async (u) => { url = u; return resp(200, {}); } });
    expect((await c.verify(ctx({ subdomain: 'api.in.exotel.com' }))).ok).toBe(true);
    expect(url).toBe('https://api.in.exotel.com/v1/Accounts/acme1/Calls.json?PageSize=1');
    expect((await createExotel({ fetch: async () => resp(404, {}) }).verify(ctx())).detail).toMatch(/SID or API host/);
    await expect(createExotel({ fetch: async () => resp(401, {}) }).verify(ctx())).rejects.toBeInstanceOf(AuthRevokedError);
    await expect(createExotel({ fetch: async () => resp(200, {}) }).verify(ctx({ subdomain: 'evil.example.com' }))).rejects.toThrow(/Blocked outbound/);
  });
  it('maps callbacks to canonical call events (answered, ended with system duration, recording)', async () => {
    const c = createExotel();
    expect(await c.parseWebhook!({ CallSid: 's1', Status: 'in-progress' })).toEqual([{ kind: 'CallEvent', callRef: 's1', state: 'answered' }]);
    expect(await c.parseWebhook!({ CallSid: 's1', Status: 'completed', ConversationDuration: '125', RecordingUrl: 'https://s3-ap.exotel.com/rec.mp3' })).toEqual([
      { kind: 'CallEvent', callRef: 's1', state: 'ended', outcome: 'completed', durationS: 125 },
      { kind: 'CallEvent', callRef: 's1', state: 'recording_ready', recordingUrl: 'https://s3-ap.exotel.com/rec.mp3' },
    ]);
    expect((await c.parseWebhook!({ CallSid: 's2', Status: 'no-answer' }))[0]).toMatchObject({ outcome: 'no_answer', durationS: undefined });
    expect((await c.parseWebhook!({ CallSid: 's3', Status: 'busy', Duration: 'NaN' }))[0]).toMatchObject({ outcome: 'busy' });
    expect(await c.parseWebhook!({ nothing: 1 })).toEqual([]);
    expect(await c.parseWebhook!({ CallSid: 's4', Status: 'queued' })).toEqual([]);
  });
  it('webhook needs the shared token; recordings only download from Exotel hosts and respect the size cap', async () => {
    const c = createExotel({ fetch: async (u) => ({ ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array(u.includes('big') ? 30_000_000 : 4).buffer, headers: { get: () => 'audio/mpeg' } }) });
    const w = c.manifest.webhook!; const raw = Buffer.from('{"CallSid":"s9","Status":"completed"}');
    expect(w.verify({ headers: {}, rawBody: raw, query: { token: 'whtok' } }, 'whtok')).toBe(true);
    expect(w.verify({ headers: {}, rawBody: raw }, 'whtok')).toBe(false);
    expect(w.extractEventId({ headers: {}, rawBody: raw })).toBe('s9:completed');
    expect((await c.fetchRecording!(ctx(), 'https://recordings.exotel.com/a.mp3')).contentType).toBe('audio/mpeg');
    await expect(c.fetchRecording!(ctx(), 'https://169.254.169.254/latest')).rejects.toThrow(/Blocked outbound/);
    await expect(c.fetchRecording!(ctx(), 'http://recordings.exotel.com/a.mp3')).rejects.toThrow(/Blocked outbound/);
    await expect(c.fetchRecording!(ctx(), 'https://recordings.exotel.com/big.mp3')).rejects.toThrow(/too large/);
  });
});
