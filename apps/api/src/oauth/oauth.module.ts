import { BadRequestException, Controller, Get, Inject, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { createHttp, type ConnectorRegistry, type FetchLike } from '@leaddesk/connectors-core';
import { googleAuthUrl } from '@leaddesk/connectors';
import { DomainError } from '@leaddesk/domain';
import { runWithTenant, type TenantDb } from '@leaddesk/db';
import { TENANT_DB } from '@leaddesk/platform';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Public, RequirePermission } from '../common/guards';
import { ConnectFacade, ConnectionsModule, HTTP_FETCH, REGISTRY } from '../connections/connections.module';

const b64url = (b: Buffer) => b.toString('base64url');
const STATE_TTL_MS = 10 * 60_000;
const cb = (provider: string) => `${(process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '')}/v1/oauth/${provider}/callback`;

/** Browser-facing OAuth: single-use state bound to tenant+user (+PKCE for Google); tokens never touch the browser. */
@Injectable()
export class OAuthService {
  private readonly http;
  constructor(
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(REGISTRY) private readonly registry: ConnectorRegistry,
    @Inject(HTTP_FETCH) fetch: FetchLike | undefined,
    private readonly connect: ConnectFacade,
    private readonly audit: AuditService,
  ) {
    this.http = createHttp({ allowedHosts: ['graph.facebook.com', 'oauth2.googleapis.com'], fetch });
  }

  async start(u: AuthUser, provider: string, q: { name?: string; spreadsheetId?: string; sheetName?: string }) {
    const c = this.registry.get(provider);
    if (!c || c.manifest.auth.type !== 'oauth2') throw new DomainError('unknown_provider', `${provider} does not use OAuth`);
    if (!process.env.PUBLIC_API_URL) throw new DomainError('not_configured', 'PUBLIC_API_URL is not configured');
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const config: Record<string, unknown> = {};
    for (const f of c.manifest.configFields) { const v = (q as Record<string, string | undefined>)[f.key]; if (v !== undefined) config[f.key] = v; }
    const meta = { name: q.name || c.manifest.displayName, config };
    await this.db.repos.oauthStates.create({ nonce, userId: u.userId, provider, codeVerifier: verifier, meta, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    const state = `${u.tenantId}.${nonce}`;
    let url: string;
    if (provider === 'meta-leadads') {
      const p = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: cb(provider), state, response_type: 'code', scope: 'leads_retrieval,pages_manage_metadata,pages_show_list,pages_read_engagement,ads_management' });
      url = `https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v26.0'}/dialog/oauth?${p}`;
    } else if (provider === 'google-sheets') {
      url = googleAuthUrl({ clientId: process.env.GOOGLE_CLIENT_ID! }, { redirectUri: cb(provider), state, codeChallenge: b64url(createHash('sha256').update(verifier).digest()) });
    } else throw new DomainError('unknown_provider', `OAuth is not implemented for ${provider}`);
    return { url };
  }

  /** Public callback: the tenant is recovered from the state prefix; the state is consumed exactly once. */
  async callback(provider: string, q: { code?: string; state?: string; error?: string }) {
    const [tenantId, nonce] = (q.state ?? '').split('.');
    if (!/^[a-f0-9]{24}$/.test(tenantId ?? '') || !nonce) throw new BadRequestException('Invalid state');
    return runWithTenant(tenantId, async () => {
      const st: any = await this.db.repos.oauthStates.findOneAndUpdate({ nonce, provider, expiresAt: { $gt: new Date() } }, { $set: { expiresAt: new Date(0) } }); // single use
      if (!st) throw new BadRequestException('OAuth state expired or already used');
      if (q.error || !q.code) throw new DomainError('oauth_denied', q.error === 'access_denied' ? 'You declined the connection' : `Provider returned: ${q.error ?? 'no code'}`);
      const credentials = provider === 'meta-leadads' ? await this.exchangeMeta(q.code) : await this.exchangeGoogle(q.code, st.codeVerifier);
      const out = await this.connect.conns.create({ provider, name: st.meta?.name ?? provider, credentials, config: st.meta?.config });
      await runWithTenant(tenantId, () => this.audit.record({ action: 'connection.oauth_connected', entity: 'connection', entityId: out.connection.id, meta: { provider } }), { userId: String(st.userId) });
      return out.connection;
    });
  }

  private async exchangeMeta(code: string) {
    const v = process.env.META_GRAPH_VERSION ?? 'v26.0'; const g = `https://graph.facebook.com/${v}/oauth/access_token`;
    const short = await this.http.json<any>(`${g}?${new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: cb('meta-leadads'), code })}`);
    const long = await this.http.json<any>(`${g}?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: short.access_token })}`);
    return { userToken: long.access_token as string };
  }
  private async exchangeGoogle(code: string, verifier: string) {
    const r = await this.http.json<any>('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: cb('google-sheets'), grant_type: 'authorization_code', code_verifier: verifier }).toString() });
    if (!r.refresh_token) throw new DomainError('oauth_no_refresh_token', 'Google did not return a refresh token; remove the app from your Google account permissions and try again');
    return { refreshToken: r.refresh_token as string };
  }
}

@Controller('v1/oauth')
export class OAuthController {
  constructor(private readonly svc: OAuthService) {}

  @Get(':provider/start') @RequirePermission('connections.manage')
  start(@CurrentUser() u: AuthUser, @Param('provider') p: string, @Query() q: Record<string, string>) { return this.svc.start(u, p, q); }

  @Public() @Get(':provider/callback')
  async callback(@Param('provider') p: string, @Query() q: Record<string, string>, @Res() res: Response) {
    const app = process.env.PUBLIC_APP_URL;
    try {
      const conn = await this.svc.callback(p, q);
      if (app) return res.redirect(`${app.replace(/\/$/, '')}/connections/${conn.id}?connected=1`);
      return res.json({ connection: conn });
    } catch (e: any) {
      if (app) return res.redirect(`${app.replace(/\/$/, '')}/connections?error=${encodeURIComponent(e?.code ?? 'oauth_failed')}`);
      throw e;
    }
  }
}

@Module({ imports: [ConnectionsModule], controllers: [OAuthController], providers: [OAuthService] })
export class OAuthModule {}
