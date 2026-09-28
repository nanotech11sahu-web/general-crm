import { api } from '../apiClient';
import type { EventTypeDoc, CalendarTemplateDefinition } from '../../types/sales';

export async function listTemplates() {
  const res = await api.get('/event-types/templates');
  return res.data as { categories: string[]; templates: CalendarTemplateDefinition[] };
}

export async function listEventTypes() {
  const res = await api.get('/event-types');
  return res.data.eventTypes as EventTypeDoc[];
}

export async function createEventType(payload: { name: string; templateKey?: string; templateCategory?: string }) {
  const res = await api.post('/event-types', payload);
  return res.data.eventType as EventTypeDoc;
}

export async function getEventType(id: string) {
  const res = await api.get(`/event-types/${id}`);
  return res.data as { eventType: EventTypeDoc; issues: string[] };
}

export async function updateEventType(id: string, payload: Partial<EventTypeDoc>) {
  const res = await api.patch(`/event-types/${id}`, payload);
  return res.data as { eventType: EventTypeDoc; issues: string[] };
}

export async function publishEventType(id: string) {
  const res = await api.post(`/event-types/${id}/publish`);
  return res.data.eventType as EventTypeDoc;
}

export async function unpublishEventType(id: string) {
  const res = await api.post(`/event-types/${id}/unpublish`);
  return res.data.eventType as EventTypeDoc;
}

export async function deleteEventType(id: string) {
  await api.delete(`/event-types/${id}`);
}
