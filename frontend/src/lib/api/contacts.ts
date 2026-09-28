import { api } from '../apiClient';
import type { Contact, ContactNote, TimelineEvent, Opportunity } from '../../types/crm';

export interface ContactListParams {
  search?: string;
  archived?: boolean;
  temperature?: string;
  page?: number;
  limit?: number;
}

export async function listContacts(params: ContactListParams) {
  const res = await api.get('/contacts', {
    params: { ...params, archived: params.archived ? 'true' : 'false' },
  });
  return res.data as { contacts: Contact[]; total: number; page: number; limit: number };
}

export async function getContact(id: string) {
  const res = await api.get(`/contacts/${id}`);
  return res.data.contact as Contact;
}

export async function createContact(payload: Partial<Contact>) {
  const res = await api.post('/contacts', payload);
  return res.data.contact as Contact;
}

export async function updateContact(id: string, payload: Partial<Contact>) {
  const res = await api.patch(`/contacts/${id}`, payload);
  return res.data.contact as Contact;
}

export async function archiveContact(id: string) {
  const res = await api.post(`/contacts/${id}/archive`);
  return res.data.contact as Contact;
}

export async function deleteContact(id: string) {
  await api.delete(`/contacts/${id}`);
}

export async function listContactNotes(id: string) {
  const res = await api.get(`/contacts/${id}/notes`);
  return res.data.notes as ContactNote[];
}

export async function addContactNote(id: string, body: string) {
  const res = await api.post(`/contacts/${id}/notes`, { body });
  return res.data.note as ContactNote;
}

export async function listContactTimeline(id: string) {
  const res = await api.get(`/contacts/${id}/timeline`);
  return res.data.events as TimelineEvent[];
}

export async function listContactOpportunities(id: string) {
  const res = await api.get(`/contacts/${id}/opportunities`);
  return res.data.opportunities as Opportunity[];
}

export interface LeadScoreResponse {
  score: number;
  updatedAt?: string;
  trend: { score: number; at: string }[];
  signals: { key: string; label: string; weight: number }[];
}

export async function getLeadScore(id: string) {
  const res = await api.get(`/contacts/${id}/lead-score`);
  return res.data as LeadScoreResponse;
}

export async function recalculateLeadScore(id: string) {
  const res = await api.post(`/contacts/${id}/lead-score/recalculate`);
  return res.data as { score: number; signals: { key: string; label: string; weight: number }[] };
}

export async function getNextBestAction(id: string) {
  const res = await api.post(`/contacts/${id}/next-best-action`);
  return res.data as { suggestion: string };
}
