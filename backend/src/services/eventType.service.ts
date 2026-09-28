import { IEventType } from '../models/EventType';
import { Appointment } from '../models/Appointment';

export function computeEventTypeIssues(eventType: Pick<IEventType, 'name' | 'durationMinutes' | 'availability' | 'requirePayment' | 'price' | 'bookingFormFields'>): string[] {
  const issues: string[] = [];

  if (!eventType.name || !eventType.name.trim()) {
    issues.push('Calendar Details — name is required');
  }
  if (!eventType.durationMinutes || eventType.durationMinutes <= 0) {
    issues.push('Calendar Details — duration must be greater than 0');
  }
  if (!eventType.availability?.some((w) => w.enabled)) {
    issues.push('Schedule & Availability — at least one day must be enabled');
  }
  if (eventType.requirePayment && (!eventType.price || eventType.price <= 0)) {
    issues.push('Settings & Payment — a price is required when payment is enabled');
  }
  const hasEmailField = eventType.bookingFormFields?.some((f) => f.key === 'email');
  if (!hasEmailField) {
    issues.push('Booking Form Fields — an email field is required');
  }

  return issues;
}

export interface AvailableSlot {
  startAt: string;
  endAt: string;
}

/** Naive but deterministic slot generator: walks each availability window in local server time. */
export async function computeAvailableSlots(eventType: IEventType, dateStr: string): Promise<AvailableSlot[]> {
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];

  const day = date.getDay();
  const window = eventType.availability.find((w) => w.day === day && w.enabled);
  if (!window) return [];

  const now = new Date();
  const minNoticeMs = eventType.minNoticeHours * 60 * 60 * 1000;
  const maxDate = new Date(now.getTime() + eventType.dateRangeDays * 24 * 60 * 60 * 1000);
  if (date > maxDate) return [];

  const [startH, startM] = window.startTime.split(':').map(Number);
  const [endH, endM] = window.endTime.split(':').map(Number);
  const windowStart = new Date(date);
  windowStart.setHours(startH, startM, 0, 0);
  const windowEnd = new Date(date);
  windowEnd.setHours(endH, endM, 0, 0);

  const stepMs = (eventType.durationMinutes + eventType.bufferBeforeMinutes + eventType.bufferAfterMinutes) * 60 * 1000;
  const durationMs = eventType.durationMinutes * 60 * 1000;

  const existing = await Appointment.find({
    eventTypeId: eventType._id,
    status: { $ne: 'Cancelled' },
    startAt: { $gte: windowStart, $lt: windowEnd },
  }).lean();

  const slots: AvailableSlot[] = [];
  for (let cursor = windowStart.getTime(); cursor + durationMs <= windowEnd.getTime(); cursor += stepMs) {
    const slotStart = new Date(cursor);
    const slotEnd = new Date(cursor + durationMs);
    if (slotStart.getTime() < now.getTime() + minNoticeMs) continue;

    const overlaps = existing.some((appt) => slotStart < appt.endAt && slotEnd > appt.startAt);
    if (overlaps) continue;

    slots.push({ startAt: slotStart.toISOString(), endAt: slotEnd.toISOString() });
  }

  return slots;
}
