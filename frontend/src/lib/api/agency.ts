import { api } from '../apiClient';

export interface AgencyDoc {
  _id: string;
  name: string;
  ownerUserId: string;
}

export interface AgencyWorkspace {
  _id: string;
  name: string;
  slug: string;
}

export async function getAgency() {
  const res = await api.get('/agency');
  return res.data as { agency: AgencyDoc | null; workspaces: AgencyWorkspace[] };
}

export async function createAgency(name: string) {
  const res = await api.post('/agency', { name });
  return res.data.agency as AgencyDoc;
}

export async function createSubAccount(name: string) {
  const res = await api.post('/agency/sub-accounts', { name });
  return res.data.workspace as AgencyWorkspace;
}

export interface AgencyRollup {
  workspaces: { workspaceId: string; name: string; kpis: { key: string; label: string; value: number | string | null; format: string; group: string }[] }[];
  totals: Record<string, number>;
  subAccountCount: number;
}

export async function getAgencyRollup() {
  const res = await api.get('/agency/rollup');
  return res.data as AgencyRollup;
}

export async function switchWorkspace(workspaceId: string) {
  const res = await api.post('/auth/switch-workspace', { workspaceId });
  return res.data as { accessToken: string; refreshToken: string };
}
