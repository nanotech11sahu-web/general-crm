import { api } from '../apiClient';

export interface NotificationDoc {
  _id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export async function listNotifications() {
  const res = await api.get('/notifications');
  return res.data as { notifications: NotificationDoc[]; unreadCount: number };
}

export async function markNotificationRead(id: string) {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead() {
  await api.post('/notifications/read-all');
}
