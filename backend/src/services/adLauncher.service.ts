import { Types } from 'mongoose';
import { AdCampaign } from '../models/AdCampaign';

export interface AdHealthBreakdown {
  healthScore: number;
  activePercent: number;
  deliveringPercent: number;
  withLeadsPercent: number;
  totalCampaigns: number;
}

export async function computeAdHealth(workspaceId: string | Types.ObjectId): Promise<AdHealthBreakdown> {
  const campaigns = await AdCampaign.find({ workspaceId }).lean();
  const total = campaigns.length;
  if (total === 0) {
    return { healthScore: 0, activePercent: 0, deliveringPercent: 0, withLeadsPercent: 0, totalCampaigns: 0 };
  }

  const activeCount = campaigns.filter((c) => c.status === 'active').length;
  const deliveringCount = campaigns.filter((c) => c.impressions > 0).length;
  const withLeadsCount = campaigns.filter((c) => c.leads > 0).length;

  const activePercent = (activeCount / total) * 100;
  const deliveringPercent = (deliveringCount / total) * 100;
  const withLeadsPercent = (withLeadsCount / total) * 100;

  const healthScore = Math.round(0.3 * activePercent + 0.4 * deliveringPercent + 0.3 * withLeadsPercent);

  return { healthScore, activePercent, deliveringPercent, withLeadsPercent, totalCampaigns: total };
}

export async function getAdOverview(workspaceId: string | Types.ObjectId) {
  const campaigns = await AdCampaign.find({ workspaceId }).lean();
  const spend = campaigns.reduce((sum, c) => sum + c.spend, 0);
  const leads = campaigns.reduce((sum, c) => sum + c.leads, 0);
  const clicks = campaigns.reduce((sum, c) => sum + c.clicks, 0);
  const impressions = campaigns.reduce((sum, c) => sum + c.impressions, 0);
  const cpl = leads > 0 ? spend / leads : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const health = await computeAdHealth(workspaceId);

  return {
    kpis: { spend, leads, cpl: Math.round(cpl * 100) / 100, ctr: Math.round(ctr * 100) / 100, clicks, impressions },
    health,
    topCampaigns: campaigns.sort((a, b) => b.leads - a.leads).slice(0, 5),
  };
}
