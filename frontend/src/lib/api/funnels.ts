import { api } from '../apiClient';
import type { Funnel, FunnelBlock } from '../../types/leadgen';

export async function listFunnels() {
  const res = await api.get('/funnels');
  return res.data.funnels as Funnel[];
}

export async function createFunnel(name: string) {
  const res = await api.post('/funnels', { name });
  return res.data.funnel as Funnel;
}

export async function getFunnel(id: string) {
  const res = await api.get(`/funnels/${id}`);
  return res.data.funnel as Funnel;
}

export async function updateFunnel(id: string, payload: Partial<Pick<Funnel, 'name' | 'isOnline'>> & { settings?: Partial<Funnel['settings']> }) {
  const res = await api.patch(`/funnels/${id}`, payload);
  return res.data.funnel as Funnel;
}

export async function addPage(funnelId: string, name: string, path: string) {
  const res = await api.post(`/funnels/${funnelId}/pages`, { name, path });
  return res.data.funnel as Funnel;
}

export async function updatePage(funnelId: string, pageId: string, blocks: FunnelBlock[]) {
  const res = await api.patch(`/funnels/${funnelId}/pages/${pageId}`, { blocks });
  return res.data.funnel as Funnel;
}

export async function publishPage(funnelId: string, pageId: string) {
  const res = await api.post(`/funnels/${funnelId}/pages/${pageId}/publish`);
  return res.data.funnel as Funnel;
}
