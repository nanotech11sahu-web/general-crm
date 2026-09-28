import { api } from '../apiClient';

export interface DashboardKpi {
  key: string;
  label: string;
  value: number | string | null;
  format: 'number' | 'currency' | 'percent' | 'text';
  group: string;
}

export interface DashboardKpiGroup {
  group: string;
  kpis: Omit<DashboardKpi, 'group'>[];
}

export interface DashboardResponse {
  groups: DashboardKpiGroup[];
  range: { from: string; to: string };
  timezone: string;
}

export interface DashboardLayoutEntry {
  key: string;
  visible: boolean;
}

export async function getDashboard(params: { from?: string; to?: string; staffMembershipId?: string }) {
  const res = await api.get('/dashboard', { params });
  return res.data as DashboardResponse;
}

export async function getDashboardStaff() {
  const res = await api.get('/dashboard/staff');
  return res.data.staff as { _id: string; userId: { _id: string; name: string; email: string } }[];
}

export async function getDashboardLayout() {
  const res = await api.get('/dashboard/layout');
  return res.data.layout as DashboardLayoutEntry[];
}

export async function saveDashboardLayout(layout: DashboardLayoutEntry[]) {
  const res = await api.put('/dashboard/layout', { layout });
  return res.data.layout as DashboardLayoutEntry[];
}
