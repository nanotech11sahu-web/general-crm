import { api } from '../apiClient';
import type { AdAccountDoc, AdOverview } from '../../types/leadgen2';

export async function listAdAccounts() {
  const res = await api.get('/ad-launcher/accounts');
  return res.data.accounts as AdAccountDoc[];
}

export async function connectAdAccount(platform: 'meta' | 'google' | 'linkedin') {
  const res = await api.post('/ad-launcher/accounts/connect', { platform });
  return res.data.account as AdAccountDoc;
}

export async function getAdOverview() {
  const res = await api.get('/ad-launcher/overview');
  return res.data as AdOverview;
}
