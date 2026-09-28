import { api } from '../apiClient';
import type { ChatWidgetDoc } from '../../types/leadgen';

export async function listChatWidgets() {
  const res = await api.get('/chat-widgets');
  return res.data.widgets as ChatWidgetDoc[];
}

export async function createChatWidget(payload: Record<string, unknown>) {
  const res = await api.post('/chat-widgets', payload);
  return res.data.widget as ChatWidgetDoc;
}

export async function updateChatWidget(id: string, payload: Record<string, unknown>) {
  const res = await api.patch(`/chat-widgets/${id}`, payload);
  return res.data.widget as ChatWidgetDoc;
}

export async function activateChatWidget(id: string) {
  const res = await api.post(`/chat-widgets/${id}/activate`);
  return res.data.widget as ChatWidgetDoc;
}
