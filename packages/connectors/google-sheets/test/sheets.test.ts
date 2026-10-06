import { describe, expect, it } from 'vitest';
import { AuthRevokedError, type ConnectorContext, type FetchLike } from '@leaddesk/connectors-core';
import { createGoogleSheets, googleAuthUrl } from '../src';

const SID = 'a'.repeat(30);
const VALUES = [['Name', 'Mobile', 'City'], ['Asha', '98765 43210', 'Pune'], ['', '', ''], ['Ravi', '9000000001', 'Delhi'], ['Mina', '9000000002']];
const fake = (o: { revoked?: boolean; tabs?: string[] } = {}): FetchLike => async (url) => {
  const res = (status: number, b: any) => ({ ok: status < 400, status, text: async () => JSON.stringify(b) });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return o.revoked ? res(400, { error: 'invalid_grant' }) : res(200, { access_token: 'at-1', expires_in: 3600 });
  if (url.includes('/values/')) return res(200, { values: VALUES });
  if (url.includes(`/spreadsheets/${SID}`)) return res(200, { properties: { title: 'Leads 2026' }, sheets: (o.tabs ?? ['Leads', 'Archive']).map((t) => ({ properties: { title: t } })) });
  return res(404, {});
};
const ctx = (config: any = {}): ConnectorContext => ({ tenantId: 't', connectionId: 'c', config: { spreadsheetId: SID, sheetName: 'Leads', ...config }, credentials: async () => ({ refreshToken: 'rt' }) });
const mk = (o?: any) => createGoogleSheets({ clientId: 'cid', clientSecret: 'cs', fetch: fake(o) });

describe('google sheets connector (fixture-based; not verified against live Google)', () => {
  it('verify returns title and defaults the tab; rejects unknown tab', async () => {
    expect(await mk().verify(ctx())).toMatchObject({ ok: true, patch: { config: { spreadsheetTitle: 'Leads 2026', sheetName: 'Leads' } } });
    expect((await mk().verify(ctx({ sheetName: 'Nope' }))).ok).toBe(false);
    expect((await mk().verify(ctx({ sheetName: '' }))).patch!.config!.sheetName).toBe('Leads');
  });
  it('revoked refresh token => AuthRevokedError', async () => {
    await expect(mk({ revoked: true }).health(ctx())).rejects.toBeInstanceOf(AuthRevokedError);
  });
  it('yields only new, non-blank rows after the cursor with stable per-row external refs', async () => {
    const all: any[] = []; for await (const l of mk().backfill!(ctx(), new Date())) all.push(l);
    expect(all.map((l) => l.cursor)).toEqual([2, 4, 5]);
    expect(all[0]).toMatchObject({ externalRef: `${SID}:Leads:2`, fields: { Name: 'Asha', Mobile: '98765 43210', City: 'Pune', _backfill: true } });
    expect(all[2].fields.City).toBeUndefined(); // ragged row
    const next: any[] = []; for await (const l of mk().backfill!(ctx({ backfillCursor: 4 }), new Date())) next.push(l);
    expect(next.map((l) => l.cursor)).toEqual([5]);
  });
  it('parses stored rows and builds a PKCE consent URL', async () => {
    expect((await mk().parseWebhook!({ _backfill: true, id: 'x:1', Name: 'N' }))[0]).toMatchObject({ externalRef: 'x:1', fields: { Name: 'N' } });
    const u = new URL(googleAuthUrl({ clientId: 'cid' }, { redirectUri: 'https://app/cb', state: 's', codeChallenge: 'cc' }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('scope')).toMatch(/spreadsheets.readonly/);
  });
});
