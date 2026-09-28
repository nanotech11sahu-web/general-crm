import { api } from '../apiClient';
import type { WorkflowDoc, TriggerDefinition, WorkflowRunDoc, WorkflowNodeData, WorkflowEdgeData } from '../../types/automation';

export async function listTriggers() {
  const res = await api.get('/workflows/triggers');
  return res.data.triggers as TriggerDefinition[];
}

export async function listWorkflows() {
  const res = await api.get('/workflows');
  return res.data.workflows as WorkflowDoc[];
}

export async function createWorkflow(name: string, triggerKey: string) {
  const res = await api.post('/workflows', { name, triggerKey });
  return res.data.workflow as WorkflowDoc;
}

export async function getWorkflow(id: string) {
  const res = await api.get(`/workflows/${id}`);
  return res.data as { workflow: WorkflowDoc; issues: string[] };
}

export async function updateWorkflow(id: string, payload: { name?: string; nodes?: WorkflowNodeData[]; edges?: WorkflowEdgeData[] }) {
  const res = await api.patch(`/workflows/${id}`, payload);
  return res.data as { workflow: WorkflowDoc; issues: string[] };
}

export async function publishWorkflow(id: string) {
  const res = await api.post(`/workflows/${id}/publish`);
  return res.data.workflow as WorkflowDoc;
}

export async function unpublishWorkflow(id: string) {
  const res = await api.post(`/workflows/${id}/unpublish`);
  return res.data.workflow as WorkflowDoc;
}

export async function runWorkflowOnce(id: string, contactId: string) {
  const res = await api.post(`/workflows/${id}/run-once`, { contactId });
  return res.data.run as WorkflowRunDoc;
}

export async function listWorkflowRuns(id: string) {
  const res = await api.get(`/workflows/${id}/runs`);
  return res.data.runs as WorkflowRunDoc[];
}

export async function deleteWorkflow(id: string) {
  await api.delete(`/workflows/${id}`);
}
