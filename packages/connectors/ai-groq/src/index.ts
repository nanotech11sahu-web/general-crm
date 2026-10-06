import { AuthRevokedError, createHttp, HttpError, type AiRequest, type AiResult, type Connector, type ConnectorContext, type FetchLike, type TranscribeRequest, type TranscribeResult } from '@leaddesk/connectors-core';

/** Multipart/form-data body assembled by hand so no extra dependency is needed and the bytes are exactly what the tests assert. */
export function multipart(fields: Record<string, string>, file: { name: string; filename: string; contentType: string; bytes: Buffer }): { body: Buffer; contentType: string } {
  const boundary = `----leaddesk${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; const parts: Buffer[] = [];
  const q = (v: string) => v.replace(/[\r\n"]/g, '_');
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(k)}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${q(file.name)}"; filename="${q(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export interface GroqEnv { fetch?: FetchLike; /** Platform override (https only); default is Groq's OpenAI-compatible endpoint. */ baseUrl?: string }
const DEFAULT_BASE = 'https://api.groq.com/openai/v1';

/**
 * Groq via its OpenAI-compatible API (per-tenant key, stored like any credential). gpt-oss models spend tokens on hidden
 * reasoning, so callers give `maxTokens` headroom and a low `reasoningEffort` for cheap tasks.
 * NOTE: request/response shapes follow Groq's public docs and have not been exercised against a live key.
 */
export function createGroqAi(env: GroqEnv = {}): Connector {
  const base = (env.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const host = new URL(base).hostname;
  // no automatic retries: a 429 must reach the AI service, which backs off / defers instead of hammering the provider
  const http = createHttp({ allowedHosts: [host], fetch: env.fetch, timeoutMs: 120_000, retries: 0, maxBytes: 1_000_000 });
  const SPEECH_MODEL = 'whisper-large-v3-turbo';
  const auth = async (ctx: ConnectorContext) => ({ authorization: `Bearer ${(await ctx.credentials()).apiKey}`, 'content-type': 'application/json' });
  const models = async (ctx: ConnectorContext): Promise<string[]> => {
    try { const r = await http.json<{ data?: { id: string }[] }>(`${base}/models`, { headers: await auth(ctx) }); return (r.data ?? []).map((m) => m.id); }
    catch (e) { if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new AuthRevokedError('Groq rejected the API key'); throw e; }
  };
  return {
    manifest: {
      id: 'ai-groq', category: 'ai', displayName: 'Groq (AI)', logo: 'groq', docsUrl: 'https://console.groq.com/docs',
      auth: { type: 'api_key' },
      credentialFields: [{ key: 'apiKey', label: 'Groq API key', type: 'secret', required: true, help: 'console.groq.com -> API Keys. Free-tier limits apply per Groq organisation; use your own key.' }],
      configFields: [],
      capabilities: ['ai.chat', 'ai.stt'],
    },
    async verify(ctx) {
      const { apiKey } = await ctx.credentials();
      if (!/^gsk_[A-Za-z0-9]{20,}$/.test(apiKey ?? '')) return { ok: false, detail: 'Key should start with gsk_' };
      try { const m = await models(ctx); return { ok: true, detail: `Key works. ${m.length} models available.` }; }
      catch (e) { if (e instanceof AuthRevokedError) return { ok: false, detail: 'Groq rejected this key' }; throw e; }
    },
    async health(ctx) { await models(ctx); return { ok: true }; },
    listModels: models,
    /** Groq's OpenAI-compatible Whisper endpoint (files up to ~25 MB). Same caveat: shapes follow public docs, not a live key. */
    async transcribe(ctx, req: TranscribeRequest): Promise<TranscribeResult> {
      if (req.audio.length > 24_000_000) throw new HttpError(413, 'Recording is too large to transcribe');
      const m = multipart({ model: SPEECH_MODEL, response_format: 'verbose_json', temperature: '0', ...(req.language ? { language: req.language } : {}) }, { name: 'file', filename: req.filename, contentType: req.contentType, bytes: req.audio });
      try {
        const r = await http.json<any>(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${(await ctx.credentials()).apiKey}`, 'content-type': m.contentType }, body: m.body });
        if (typeof r?.text !== 'string') throw new HttpError(502, 'Groq returned no transcript');
        return { text: r.text, language: r.language, durationS: typeof r.duration === 'number' ? Math.round(r.duration) : undefined, model: SPEECH_MODEL };
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new AuthRevokedError('Groq rejected the API key');
        throw e;
      }
    },
    async complete(ctx, req: AiRequest): Promise<AiResult> {
      const body: Record<string, unknown> = {
        model: req.model, temperature: req.temperature ?? 0.2, max_completion_tokens: req.maxTokens,
        messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      };
      if (req.json) body.response_format = { type: 'json_object' };
      if (req.reasoningEffort && /gpt-oss/.test(req.model)) body.reasoning_effort = req.reasoningEffort;
      try {
        const r = await http.json<any>(`${base}/chat/completions`, { method: 'POST', headers: await auth(ctx), body: JSON.stringify(body) });
        const text = r?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new HttpError(502, 'Groq returned no message content');
        return { text, model: String(r.model ?? req.model), usage: { promptTokens: Number(r.usage?.prompt_tokens ?? 0), completionTokens: Number(r.usage?.completion_tokens ?? 0) } };
      } catch (e) {
        if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new AuthRevokedError('Groq rejected the API key');
        throw e;
      }
    },
  };
}
