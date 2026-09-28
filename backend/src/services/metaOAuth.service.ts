import { env } from '../config/env';

export const META_ADS_SCOPES = ['ads_management', 'ads_read', 'business_management'].join(',');
export const META_LEAD_ADS_SCOPES = ['leads_retrieval', 'pages_show_list', 'pages_manage_metadata'].join(',');

export type MetaOAuthIntent = 'ads' | 'facebook_lead_ads' | 'instagram_lead_ads';

export interface MetaOAuthState {
  workspaceId: string;
  nonce: string;
  intent: MetaOAuthIntent;
}

/** Each workspace registers its own Meta app (id/secret), so this is never read from a server-wide env var. */
export function metaRedirectUri(): string {
  return `${env.apiPublicUrl}/api/ad-launcher/accounts/meta/oauth-callback`;
}

export function buildMetaOAuthUrl(appId: string, state: string, scopes: string): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: metaRedirectUri(),
    state,
    scope: scopes,
    response_type: 'code',
  });
  return `https://www.facebook.com/${env.metaApiVersion}/dialog/oauth?${params.toString()}`;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = `https://graph.facebook.com/${env.metaApiVersion}${path}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) {
    const message = (body as { error?: { message?: string } })?.error?.message ?? `Meta Graph API error (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

/** Exchanges an OAuth `code` for a short-lived user access token, using the workspace's own Meta app credentials. */
export async function exchangeCodeForToken(appId: string, appSecret: string, code: string): Promise<MetaTokenResponse> {
  return graphGet<MetaTokenResponse>('/oauth/access_token', {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: metaRedirectUri(),
    code,
  });
}

/** Exchanges a short-lived token for a long-lived one (~60 days). */
export async function exchangeForLongLivedToken(appId: string, appSecret: string, shortLivedToken: string): Promise<MetaTokenResponse> {
  return graphGet<MetaTokenResponse>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
}

interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number;
}

/** Lists the ad accounts the authenticated user can access. */
export async function listMetaAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
  const result = await graphGet<{ data: MetaAdAccount[] }>('/me/adaccounts', {
    fields: 'id,name,account_status',
    access_token: accessToken,
  });
  return result.data ?? [];
}

interface MetaPage {
  id: string;
  name: string;
}

/** Lists the Facebook Pages the authenticated user manages (needed for Lead Ads forms). */
export async function listMetaPages(accessToken: string): Promise<MetaPage[]> {
  const result = await graphGet<{ data: MetaPage[] }>('/me/accounts', {
    fields: 'id,name',
    access_token: accessToken,
  });
  return result.data ?? [];
}

/** Best-effort revoke of all permissions granted to this app by the user. */
export async function revokeMetaToken(userAccessToken: string): Promise<void> {
  const url = `https://graph.facebook.com/${env.metaApiVersion}/me/permissions?access_token=${encodeURIComponent(userAccessToken)}`;
  try {
    await fetch(url, { method: 'DELETE' });
  } catch {
    // best-effort — the token may already be expired/invalid, nothing more we can do
  }
}
