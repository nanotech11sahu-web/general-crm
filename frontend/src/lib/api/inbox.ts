import { api } from '../apiClient';
import type { InboxConversation, InboxMessage, InboxDashboard, InboxFilter, InboxChannel, CannedReply } from '../../types/inbox';

export async function getInboxDashboard() {
  const res = await api.get('/inbox/dashboard');
  return res.data as InboxDashboard;
}

export async function listConversations(filter: InboxFilter = 'all') {
  const res = await api.get('/inbox/conversations', { params: { filter } });
  return res.data.conversations as InboxConversation[];
}

export async function getConversationMessages(contactId: string) {
  const res = await api.get(`/inbox/conversations/${contactId}/messages`);
  return res.data.messages as InboxMessage[];
}

export async function replyToConversation(contactId: string, channel: InboxChannel, message: string) {
  const res = await api.post(`/inbox/conversations/${contactId}/reply`, { channel, message });
  return res.data.messages as InboxMessage[];
}

export async function simulateInbound(contactId: string, message: string) {
  const res = await api.post(`/inbox/conversations/${contactId}/simulate-inbound`, { message });
  return res.data.message;
}

export async function starConversation(contactId: string, starred: boolean) {
  const res = await api.post(`/inbox/conversations/${contactId}/star`, { starred });
  return res.data.state;
}

export async function snoozeConversation(contactId: string, snoozedUntil: string | null) {
  const res = await api.post(`/inbox/conversations/${contactId}/snooze`, { snoozedUntil });
  return res.data.state;
}

export async function listCannedReplies() {
  const res = await api.get('/inbox/canned-replies');
  return res.data.cannedReplies as CannedReply[];
}

export async function createCannedReply(payload: { title: string; body: string }) {
  const res = await api.post('/inbox/canned-replies', payload);
  return res.data.cannedReply as CannedReply;
}
