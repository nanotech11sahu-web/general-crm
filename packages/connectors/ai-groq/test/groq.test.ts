import { describe, expect, it } from 'vitest';
import { AuthRevokedError, HttpError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { createGroqAi } from '../src';

const ctx = (apiKey = 'gsk_' + 'a'.repeat(30)): ConnectorContext => ({ tenantId: 't', connectionId: 'c', config: {}, credentials: async () => ({ apiKey }) });
const resp = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });

describe('groq connector (documented-shape fixtures; not verified live)', () => {
  it('posts an OpenAI-style chat completion with json mode, token headroom and low reasoning for gpt-oss', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => { seen = { url, headers: init?.headers, body: JSON.parse(String(init!.body!)) }; return resp(200, { model: 'openai/gpt-oss-20b', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 40, completion_tokens: 12 } }); };
    const r = await createGroqAi({ fetch: f }).complete!(ctx(), { model: 'openai/gpt-oss-20b', system: 'sys', user: 'usr', maxTokens: 900, json: true, reasoningEffort: 'low' });
    expect(r).toEqual({ text: '{"ok":true}', model: 'openai/gpt-oss-20b', usage: { promptTokens: 40, completionTokens: 12 } });
    expect(seen.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(seen.headers.authorization).toBe('Bearer ' + 'gsk_' + 'a'.repeat(30));
    expect(seen.body).toMatchObject({ model: 'openai/gpt-oss-20b', max_completion_tokens: 900, response_format: { type: 'json_object' }, reasoning_effort: 'low', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }] });
  });
  it('omits reasoning_effort for non-reasoning models', async () => {
    let body: any; const f: FetchLike = async (_u, i) => { body = JSON.parse(String(i!.body!)); return resp(200, { choices: [{ message: { content: 'x' } }] }); };
    await createGroqAi({ fetch: f }).complete!(ctx(), { model: 'some-other-model', system: 's', user: 'u', maxTokens: 10, reasoningEffort: 'low' });
    expect(body.reasoning_effort).toBeUndefined(); expect(body.response_format).toBeUndefined();
  });
  it('lists models, verifies the key shape offline, maps 401 to AuthRevoked and surfaces 429 without retrying', async () => {
    const c = createGroqAi({ fetch: async () => resp(200, { data: [{ id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3-turbo' }] }) });
    expect(await c.listModels!(ctx())).toEqual(['openai/gpt-oss-120b', 'whisper-large-v3-turbo']);
    expect((await c.verify(ctx())).ok).toBe(true);
    expect(await c.verify(ctx('sk-not-groq'))).toMatchObject({ ok: false });
    await expect(createGroqAi({ fetch: async () => resp(401, {}) }).health(ctx())).rejects.toBeInstanceOf(AuthRevokedError);
    expect(await createGroqAi({ fetch: async () => resp(401, {}) }).verify(ctx())).toMatchObject({ ok: false, detail: 'Groq rejected this key' });
    let calls = 0;
    await expect(createGroqAi({ fetch: async () => { calls++; return resp(429, { error: { message: 'rate limit' } }); } }).complete!(ctx(), { model: 'm', system: 's', user: 'u', maxTokens: 5 })).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(1);
    await expect(createGroqAi({ fetch: async () => resp(200, { choices: [] }) }).complete!(ctx(), { model: 'm', system: 's', user: 'u', maxTokens: 5 })).rejects.toBeInstanceOf(HttpError);
  });
  it('only talks to the configured https host', async () => {
    await expect(createGroqAi({ baseUrl: 'http://api.groq.com/openai/v1', fetch: async () => resp(200, {}) }).listModels!(ctx())).rejects.toThrow(/Blocked outbound/);
  });
  it('transcribes a recording through the Whisper endpoint with a well-formed multipart body', async () => {
    let seen: any;
    const f: FetchLike = async (url, init) => { seen = { url, headers: init?.headers, body: Buffer.from(init!.body as Uint8Array) }; return resp(200, { text: 'namaste, main Asha bol rahi hoon', language: 'hi', duration: 41.6 }); };
    const r = await createGroqAi({ fetch: f }).transcribe!(ctx(), { audio: Buffer.from('FAKEAUDIOBYTES'), filename: 'call.mp3', contentType: 'audio/mpeg', language: 'hi' });
    expect(r).toEqual({ text: 'namaste, main Asha bol rahi hoon', language: 'hi', durationS: 42, model: 'whisper-large-v3-turbo' });
    expect(seen.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(seen.headers.authorization).toBe('Bearer ' + 'gsk_' + 'a'.repeat(30)); expect(seen.headers['content-type']).toMatch(/^multipart\/form-data; boundary=----leaddesk/);
    const text = seen.body.toString('latin1');
    expect(text).toContain('name="model"\r\n\r\nwhisper-large-v3-turbo'); expect(text).toContain('name="language"\r\n\r\nhi');
    expect(text).toContain('name="file"; filename="call.mp3"\r\nContent-Type: audio/mpeg\r\n\r\nFAKEAUDIOBYTES');
  });
  it('refuses oversize audio, strips header-injection characters from the filename, and reports a revoked key', async () => {
    const f: FetchLike = async () => resp(401, { error: { message: 'bad key' } });
    const c = createGroqAi({ fetch: f });
    await expect(c.transcribe!(ctx(), { audio: Buffer.alloc(24_000_001), filename: 'a.mp3', contentType: 'audio/mpeg' })).rejects.toMatchObject({ status: 413 });
    await expect(c.transcribe!(ctx(), { audio: Buffer.from('x'), filename: 'a"\r\nX-Evil: 1.mp3', contentType: 'audio/mpeg' })).rejects.toMatchObject({ name: 'AuthRevokedError' });
    let body = ''; const g: FetchLike = async (_u, i) => { body = Buffer.from(i!.body as Uint8Array).toString('latin1'); return resp(200, { text: 'ok' }); };
    await createGroqAi({ fetch: g }).transcribe!(ctx(), { audio: Buffer.from('x'), filename: 'a"\r\nX-Evil: 1.mp3', contentType: 'audio/mpeg' });
    expect(body).not.toContain('\r\nX-Evil'); expect(body).toContain('filename="a___X-Evil: 1.mp3"');
  });
});
