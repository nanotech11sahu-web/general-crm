import { api } from '../apiClient';
import type { LeaderboardRow, IncentiveSettingDoc } from '../../types/sales';

export async function getOverview(view: 'team' | 'my') {
  const res = await api.get('/sales-performance/overview', { params: { view } });
  return res.data.kpis as { verifiedRevenue: number; totalActions: number; callsMade: number; activeNow: number; avgResponseSeconds: number | null };
}

export async function getLeaderboard(view: 'team' | 'my') {
  const res = await api.get('/sales-performance/leaderboard', { params: { view } });
  return res.data.leaderboard as LeaderboardRow[];
}

export async function logActivity(payload: { type: 'call' | 'action' | 'revenue' | 'response'; amount?: number; responseTimeSeconds?: number; note?: string }) {
  const res = await api.post('/sales-performance/activities', payload);
  return res.data.activity;
}

export async function getIncentiveSettings() {
  const res = await api.get('/sales-performance/incentive-settings');
  return res.data as { settings: IncentiveSettingDoc[]; memberships: { _id: string; userId: { name?: string; email?: string } }[] };
}

export async function saveIncentiveSetting(payload: { membershipId: string; incentiveAmount: number; notes?: string }) {
  const res = await api.put('/sales-performance/incentive-settings', payload);
  return res.data.setting as IncentiveSettingDoc;
}
