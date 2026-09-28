import { api } from '../apiClient';
import type { BulkCampaignDoc } from '../../types/automation';

export async function listBulkCampaigns(status?: string) {
  const res = await api.get('/bulk-campaigns', { params: status && status !== 'All' ? { status } : undefined });
  return res.data.campaigns as BulkCampaignDoc[];
}

export async function createBulkCampaign(payload: { name: string; channels: string[]; emailSubject?: string; message?: string }) {
  const res = await api.post('/bulk-campaigns', payload);
  return res.data.campaign as BulkCampaignDoc;
}

export async function sendBulkCampaign(id: string) {
  const res = await api.post(`/bulk-campaigns/${id}/send`);
  return res.data.campaign as BulkCampaignDoc;
}
