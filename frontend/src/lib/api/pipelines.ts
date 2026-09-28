import { api } from '../apiClient';
import type { Pipeline, Opportunity } from '../../types/crm';

export async function listPipelines() {
  const res = await api.get('/pipelines');
  return res.data.pipelines as Pipeline[];
}

export async function createPipeline(payload: { name: string; stages: Pipeline['stages'] }) {
  const res = await api.post('/pipelines', payload);
  return res.data.pipeline as Pipeline;
}

export async function listOpportunities(pipelineId: string) {
  const res = await api.get('/opportunities', { params: { pipelineId } });
  return res.data.opportunities as Opportunity[];
}

export async function createOpportunity(payload: {
  contactId: string;
  pipelineId: string;
  stageKey: string;
  name: string;
  productInterest?: string;
  city?: string;
  value?: number;
}) {
  const res = await api.post('/opportunities', payload);
  return res.data.opportunity as Opportunity;
}

export async function moveOpportunity(id: string, stageKey: string, order: number) {
  const res = await api.patch(`/opportunities/${id}/move`, { stageKey, order });
  return res.data.opportunity as Opportunity;
}
