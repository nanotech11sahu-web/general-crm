import { api } from '../apiClient';

export interface ContactStats {
  kpis: {
    newContacts: number;
    dailyAverage: number;
    peakDay: { date: string; count: number } | null;
    topSource: string | null;
    topCity: string | null;
    uniqueSources: number;
  };
  funnel: { step: string; count: number }[];
  dailySeries: { date: string; count: number }[];
  sourceLeaderboard: { source: string; count: number }[];
  cityLeaderboard: { city: string; count: number }[];
  lifecycleBreakdown: { stage: string; count: number }[];
  heatmap: { dayOfWeek: number; hour: number; count: number }[];
}

export async function getContactStats(params?: { from?: string; to?: string }) {
  const res = await api.get('/contact-stats', { params });
  return res.data as ContactStats;
}
