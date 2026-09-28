import { api } from '../apiClient';
import type { WebinarDoc } from '../../types/sales';

export async function getZoomStatus() {
  const res = await api.get('/webinars/zoom-status');
  return res.data as { connected: boolean; accountEmail?: string };
}

export async function connectZoom() {
  const res = await api.post('/webinars/zoom-connect');
  return res.data as { connected: boolean; accountEmail?: string };
}

export async function listWebinars(status?: string) {
  const res = await api.get('/webinars', { params: status ? { status } : undefined });
  return res.data.webinars as WebinarDoc[];
}

export async function createWebinar(payload: Partial<WebinarDoc> & { topic: string; startAt: string }) {
  const res = await api.post('/webinars', payload);
  return res.data.webinar as WebinarDoc;
}

export async function updateWebinar(id: string, payload: Partial<WebinarDoc>) {
  const res = await api.patch(`/webinars/${id}`, payload);
  return res.data.webinar as WebinarDoc;
}

export async function deleteWebinar(id: string) {
  await api.delete(`/webinars/${id}`);
}
