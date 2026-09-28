import { api } from '../apiClient';
import type { AppointmentDoc, AppointmentStatus } from '../../types/sales';

export async function listAppointments(params?: { contactId?: string; status?: string; from?: string; to?: string }) {
  const res = await api.get('/appointments', { params });
  return res.data.appointments as AppointmentDoc[];
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus, extra?: { startAt?: string; endAt?: string }) {
  const res = await api.patch(`/appointments/${id}`, { status, ...extra });
  return res.data.appointment as AppointmentDoc;
}
