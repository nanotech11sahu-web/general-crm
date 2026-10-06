import { AuthRevokedError, createHttp, HttpError, type BackfillLead, type CanonicalEvent, type Connector, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';

export interface GoogleEnv { clientId: string; clientSecret: string; fetch?: FetchLike }

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_ROWS = 50_000;

export function googleAuthUrl(env: Pick<GoogleEnv, 'clientId'>, o: { redirectUri: string; state: string; codeChallenge: string }) {
  const p = new URLSearchParams({ client_id: env.clientId, redirect_uri: o.redirectUri, response_type: 'code', scope: SHEETS_SCOPE, access_type: 'offline', prompt: 'consent', state: o.state, code_challenge: o.codeChallenge, code_challenge_method: 'S256' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export function createGoogleSheets(env: GoogleEnv): Connector {
  const http = createHttp({ allowedHosts: ['oauth2.googleapis.com', 'sheets.googleapis.com'], fetch: env.fetch });

  /** Access tokens last an hour; mint one from the stored refresh token per run. `invalid_grant` = revoked. */
  async function accessToken(ctx: ConnectorContext): Promise<string> {
    const { refreshToken } = await ctx.credentials();
    try {
      const r = await http.json<any>('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString() });
      return r.access_token;
    } catch (e) {
      if (e instanceof HttpError && (e.body?.error === 'invalid_grant' || e.status === 401)) throw new AuthRevokedError('Google access was revoked or expired. Reconnect.');
      throw e;
    }
  }
  const sheetsGet = async (token: string, path: string) => {
    try { return await http.json<any>(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { headers: { authorization: `Bearer ${token}` } }); }
    catch (e) { if (e instanceof HttpError && (e.status === 401)) throw new AuthRevokedError('Google rejected the access token'); throw e; }
  };
  const cfg = (ctx: ConnectorContext) => ({ id: String(ctx.config.spreadsheetId ?? ''), sheet: String(ctx.config.sheetName ?? '') });

  return {
    manifest: {
      id: 'google-sheets', category: 'lead_source', displayName: 'Google Sheets', logo: 'sheets', docsUrl: 'https://developers.google.com/sheets/api',
      auth: { type: 'oauth2' },
      credentialFields: [{ key: 'refreshToken', label: 'Refresh token', type: 'secret', required: true, help: 'Use “Connect with Google”.' }],
      configFields: [
        { key: 'spreadsheetId', label: 'Spreadsheet ID', type: 'text', required: true, pattern: '^[A-Za-z0-9_-]{20,}$', help: 'The long id in the sheet URL.' },
        { key: 'sheetName', label: 'Tab name', type: 'text', required: false, help: 'Defaults to the first tab. Row 1 must hold column headers.' },
        { key: 'fieldMapping', label: 'Field mapping (JSON: header -> target)', type: 'text', required: false },
      ],
      capabilities: ['lead.backfill'],
    },

    async verify(ctx) {
      const { id } = cfg(ctx);
      const token = await accessToken(ctx);
      const meta = await sheetsGet(token, `${encodeURIComponent(id)}?fields=properties.title,sheets.properties.title`);
      const tabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title);
      const want = String(ctx.config.sheetName ?? '');
      if (want && !tabs.includes(want)) return { ok: false, detail: `Tab "${want}" not found. Available: ${tabs.join(', ')}` };
      return { ok: true, patch: { config: { spreadsheetTitle: meta.properties?.title, sheetName: want || tabs[0] } } };
    },
    async health(ctx) { await accessToken(ctx); return { ok: true }; },

    /** Append-only: only rows after `config.backfillCursor`; the platform advances the cursor as rows are handled. */
    async *backfill(ctx): AsyncIterable<BackfillLead> {
      const { id, sheet } = cfg(ctx);
      const token = await accessToken(ctx);
      const range = encodeURIComponent(`${sheet || 'Sheet1'}!A1:ZZ${MAX_ROWS}`);
      const data = await sheetsGet(token, `${encodeURIComponent(id)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
      const rows: string[][] = data.values ?? [];
      if (rows.length < 2) return;
      const headers = rows[0].map((h, i) => String(h ?? '').trim() || `column_${i + 1}`);
      const from = Number(ctx.config.backfillCursor ?? 1); // row 1 = headers
      for (let r = Math.max(from + 1, 2); r <= rows.length; r++) {
        const row = rows[r - 1];
        if (!row || row.every((c) => !String(c ?? '').trim())) continue;
        const fields: Record<string, unknown> = { _backfill: true };
        headers.forEach((h, i) => { if (row[i] !== undefined && String(row[i]).trim()) fields[h] = String(row[i]).trim(); });
        yield { externalRef: `${id}:${sheet || 'Sheet1'}:${r}`, fields, cursor: r };
      }
    },

    async parseWebhook(raw: any): Promise<CanonicalEvent[]> {
      const { id, ...fields } = raw ?? {};
      delete (fields as Record<string, unknown>)._backfill;
      return [{ kind: 'LeadReceived', externalRef: String(id), fields }];
    },
  };
}
