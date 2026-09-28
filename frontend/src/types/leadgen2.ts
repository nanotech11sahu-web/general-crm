export interface EcomProduct {
  _id: string;
  name: string;
  description?: string;
  salePrice: number;
  currency: string;
  mrp?: number;
  costPrice?: number;
  sku?: string;
  collectionId?: string;
  images: string[];
  seoSlug: string;
  visibility: 'draft' | 'published';
  stockTracking: boolean;
  featured: boolean;
  createdAt: string;
}

export interface EcomCollection {
  _id: string;
  name: string;
  slug: string;
}

export interface TaxProfileDoc {
  _id: string;
  name: string;
  ratePercent: number;
  isDefault: boolean;
}

export interface AdAccountDoc {
  _id: string;
  platform: 'meta' | 'google' | 'linkedin';
  status: 'not_connected' | 'connected';
  externalAccountId?: string;
}

export interface AdOverview {
  kpis: { spend: number; leads: number; cpl: number; ctr: number; clicks: number; impressions: number };
  health: { healthScore: number; activePercent: number; deliveringPercent: number; withLeadsPercent: number; totalCampaigns: number };
  topCampaigns: { _id: string; name: string; status: string; leads: number; spend: number }[];
}

export interface SocialChannelDoc {
  _id: string;
  platform: 'instagram' | 'facebook' | 'linkedin' | 'twitter';
  status: 'connected' | 'expiring_soon' | 'expired' | 'not_connected';
}

export interface SocialDashboard {
  kpis: { reach: number; engagementRate: number; postsPublished: number; totalAudience: number };
  deliveryFunnel: Record<string, number>;
  connectionHealth: { connected: number; expiringSoon: number; expired: number };
  channels: SocialChannelDoc[];
}

export interface VibeProspect {
  id: string;
  name: string;
  company: string;
  city: string;
  title: string;
  saved: boolean;
}

export interface VibeSearchDoc {
  _id: string;
  query: string;
  results: VibeProspect[];
  creditsSpent: number;
  createdAt: string;
}

export interface VibeStats {
  searchesToday: number;
  totalSearches: number;
  leadsSaved: number;
  convertedToCrm: number;
  creditsSpent7d: number;
  avgResultsPerSearch: number;
  saveRate: number;
  walletBalance: number;
}

export interface DomainDoc {
  _id: string;
  hostname: string;
  verified: boolean;
}

export interface ShortLinkDoc {
  _id: string;
  destinationUrl: string;
  title?: string;
  slug: string;
  domainId: string;
  clicks: number;
  uniqueClicks: number;
  createdAt: string;
}
