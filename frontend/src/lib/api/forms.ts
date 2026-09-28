import { api } from '../apiClient';
import type { FormDoc, FormField } from '../../types/leadgen';

export async function listForms() {
  const res = await api.get('/forms');
  return res.data.forms as FormDoc[];
}

export async function createForm(name: string) {
  const res = await api.post('/forms', { name });
  return res.data.form as FormDoc;
}

export async function createFormWithAi(prompt: string) {
  const res = await api.post('/forms/ai-builder', { prompt });
  return res.data.form as FormDoc;
}

export async function getForm(id: string) {
  const res = await api.get(`/forms/${id}`);
  return res.data.form as FormDoc;
}

export async function updateForm(
  id: string,
  payload: Partial<{
    name: string;
    status: 'draft' | 'published';
    fields: FormField[];
    style: Partial<FormDoc['style']>;
    settings: Partial<FormDoc['settings']>;
  }>,
) {
  const res = await api.patch(`/forms/${id}`, payload);
  return res.data.form as FormDoc;
}

export async function deleteForm(id: string) {
  await api.delete(`/forms/${id}`);
}

export async function getFormSubmissions(id: string) {
  const res = await api.get(`/forms/${id}/submissions`);
  return res.data.submissions as { _id: string; data: Record<string, unknown>; createdAt: string }[];
}

export async function getFormAnalytics(id: string) {
  const res = await api.get(`/forms/${id}/analytics`);
  return res.data as { totalSubmissions: number; contactsCreated: number };
}
