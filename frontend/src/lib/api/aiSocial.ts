import { api } from '../apiClient';
import type { SocialChannelDoc, SocialDashboard } from '../../types/leadgen2';

export async function getSocialDashboard() {
  const res = await api.get('/ai-social/dashboard');
  return res.data as SocialDashboard;
}

export async function connectSocialChannel(platform: SocialChannelDoc['platform']) {
  const res = await api.post('/ai-social/channels/connect', { platform });
  return res.data.channel as SocialChannelDoc;
}

export async function createSocialPost(payload: { content: string; channels: string[]; mode: 'draft' | 'publish' }) {
  const res = await api.post('/ai-social/posts', payload);
  return res.data.post;
}
