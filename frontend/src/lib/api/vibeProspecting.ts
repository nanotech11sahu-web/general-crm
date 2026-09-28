import { api } from '../apiClient';
import type { VibeSearchDoc, VibeStats } from '../../types/leadgen2';

export async function searchProspects(query: string) {
  const res = await api.post('/vibe-prospecting/search', { query });
  return res.data as { search: VibeSearchDoc; walletBalance: number };
}

export async function saveProspect(searchId: string, resultId: string) {
  const res = await api.post(`/vibe-prospecting/searches/${searchId}/results/${resultId}/save`);
  return res.data.contact;
}

export async function getVibeStats() {
  const res = await api.get('/vibe-prospecting/stats');
  return res.data as VibeStats;
}
