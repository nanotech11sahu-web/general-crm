import { api } from '../apiClient';
import type { EmailCampaignDoc } from '../../types/automation';

export async function getEmailDashboard() {
  const res = await api.get('/email-marketing/dashboard');
  return res.data as {
    kpis: {
      totalCampaigns: number;
      totalSent: number;
      delivered: number;
      opened: number;
      clicked: number;
      bounced: number;
      avgOpenRate: number;
      avgClickRate: number;
      activeCampaigns: number;
    };
    campaigns: EmailCampaignDoc[];
  };
}

export async function listEmailCampaigns() {
  const res = await api.get('/email-marketing/campaigns');
  return res.data.campaigns as EmailCampaignDoc[];
}

export async function createEmailCampaign(payload: { name: string; subject: string; fromName?: string; fromEmail?: string; bodyPreview?: string }) {
  const res = await api.post('/email-marketing/campaigns', payload);
  return res.data.campaign as EmailCampaignDoc;
}

export async function generateAiEmailCompose(prompt: string) {
  const res = await api.post('/email-marketing/ai-compose', { prompt });
  return res.data.suggestion as { subject: string; bodyPreview: string };
}

export async function sendTestEmail(campaignId: string, contactId: string) {
  const res = await api.post(`/email-marketing/campaigns/${campaignId}/send-test`, { contactId });
  return res.data.result as string;
}

export async function sendEmailCampaignNow(campaignId: string) {
  const res = await api.post(`/email-marketing/campaigns/${campaignId}/send-now`);
  return res.data as { campaign: EmailCampaignDoc; sent: number; suppressed: number };
}
