import { api } from '../apiClient';
import type { AdAccountDoc, AdOverview } from '../../types/leadgen2';

export async function listAdAccounts() {
  const res = await api.get('/ad-launcher/accounts');
  return res.data.accounts as AdAccountDoc[];
}

export async function getMetaOAuthUrl() {
  const res = await api.get('/ad-launcher/accounts/meta/oauth-url');
  return res.data.url as string;
}

export async function disconnectAdAccount(platform: 'meta' | 'google' | 'linkedin') {
  const res = await api.post(`/ad-launcher/accounts/${platform}/disconnect`);
  return res.data.account as AdAccountDoc;
}

export async function getAdOverview() {
  const res = await api.get('/ad-launcher/overview');
  return res.data as AdOverview;
}
