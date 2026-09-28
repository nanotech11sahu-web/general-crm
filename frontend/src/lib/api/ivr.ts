import { api } from '../apiClient';
import type { CallLogDoc, CallProviderDoc } from '../../types/sales';

export async function getIvrOverview() {
  const res = await api.get('/ivr/overview');
  return res.data.kpis as { totalCalls: number; connected: number; missed: number; talkTimeSeconds: number; uniqueClients: number; agentsActive: number };
}

export async function listCalls(filters?: Record<string, string>) {
  const res = await api.get('/ivr/calls', { params: filters });
  return res.data.calls as CallLogDoc[];
}

export async function listAgents() {
  const res = await api.get('/ivr/agents');
  return res.data.agents as { _id: string; userId: { name?: string; email?: string } }[];
}

export async function listProviders() {
  const res = await api.get('/ivr/providers');
  return res.data.providers as CallProviderDoc[];
}

export async function connectProvider(key: string) {
  const res = await api.post(`/ivr/providers/${key}/connect`);
  return res.data as { providerKey: string; connected: boolean };
}

export async function dial(payload: { toNumber: string; contactId?: string; source?: string }) {
  const res = await api.post('/ivr/dial', payload);
  return res.data.call as CallLogDoc;
}
