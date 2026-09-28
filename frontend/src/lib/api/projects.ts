import { api } from '../apiClient';
import type { ProjectDoc } from '../../types/operations';

export async function listProjects(status?: string) {
  const res = await api.get('/projects', { params: status ? { status } : undefined });
  return res.data.projects as ProjectDoc[];
}

export async function getProject(id: string) {
  const res = await api.get(`/projects/${id}`);
  return res.data.project as ProjectDoc;
}

export async function createProject(payload: Partial<ProjectDoc> & { title: string }) {
  const res = await api.post('/projects', payload);
  return res.data.project as ProjectDoc;
}

export async function updateProject(id: string, payload: Partial<ProjectDoc>) {
  const res = await api.patch(`/projects/${id}`, payload);
  return res.data.project as ProjectDoc;
}

export async function getContactProjects(contactId: string) {
  const res = await api.get(`/contacts/${contactId}/projects`);
  return res.data.projects as ProjectDoc[];
}
