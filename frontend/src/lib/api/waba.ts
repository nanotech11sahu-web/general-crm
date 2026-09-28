import { api } from '../apiClient';
import type { WabaAccountDoc, WabaTemplateDoc } from '../../types/automation';

export async function getWabaDashboard() {
  const res = await api.get('/waba/dashboard');
  return res.data as { account: WabaAccountDoc; wallet: { balance: number }; optOutCount: number };
}

export async function setupWaba(payload: { onboardingType: 'own_number' | 'coexistence'; billingMode: 'byob' | 'credit_line' }) {
  const res = await api.post('/waba/setup', payload);
  return res.data.account as WabaAccountDoc;
}

export async function updateWabaCompliance(autoOptOutEnabled: boolean) {
  const res = await api.patch('/waba/compliance', { autoOptOutEnabled });
  return res.data.account as WabaAccountDoc;
}

export async function listOptOuts() {
  const res = await api.get('/waba/opt-outs');
  return res.data.optOuts as { _id: string; contactId: { name: string; phone?: string }; keyword: string; createdAt: string }[];
}

export async function simulateInboundMessage(contactId: string, text: string) {
  const res = await api.post('/waba/inbound', { contactId, text });
  return res.data as { optedOut: boolean; keyword: string | null };
}

export async function listWabaTemplates() {
  const res = await api.get('/waba/templates');
  return res.data.templates as WabaTemplateDoc[];
}

export async function createWabaTemplate(name: string, body: string) {
  const res = await api.post('/waba/templates', { name, body });
  return res.data.template as WabaTemplateDoc;
}

export async function approveWabaTemplate(id: string) {
  const res = await api.post(`/waba/templates/${id}/approve`);
  return res.data.template as WabaTemplateDoc;
}
