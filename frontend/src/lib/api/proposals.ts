import { api } from '../apiClient';
import type { ProposalDoc } from '../../types/sales';

export async function listProposals(status?: string) {
  const res = await api.get('/proposals', { params: status ? { status } : undefined });
  return res.data.proposals as ProposalDoc[];
}

export async function getProposalKpis() {
  const res = await api.get('/proposals/kpis');
  return res.data as { funnel: Record<string, number>; pipelineValue: number; wonValue: number; winRate: number };
}

export async function createProposal(payload: { name: string; contactId?: string; value?: number; content?: string }) {
  const res = await api.post('/proposals', payload);
  return res.data.proposal as ProposalDoc;
}

export async function transitionProposal(id: string, action: 'publish' | 'send' | 'view' | 'decline' | 'convert') {
  const res = await api.post(`/proposals/${id}/${action}`);
  return res.data.proposal as ProposalDoc;
}

export async function approveProposal(id: string, signatureName: string) {
  const res = await api.post(`/proposals/${id}/approve`, { signatureName });
  return res.data.proposal as ProposalDoc;
}

export async function deleteProposal(id: string) {
  await api.delete(`/proposals/${id}`);
}
