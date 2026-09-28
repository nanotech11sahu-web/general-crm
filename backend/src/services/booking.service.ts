import { IEventType } from '../models/EventType';
import { Appointment, AppointmentStatus } from '../models/Appointment';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { emitPlatformEvent } from '../lib/eventBus';

export interface BookAppointmentInput {
  eventType: IEventType;
  startAt: Date;
  endAt: Date;
  formResponses: Record<string, unknown>;
}

function pickStaffMembershipId(eventType: IEventType): string | undefined {
  if (!eventType.staffMembershipIds.length) return undefined;
  const index = Math.floor(Math.random() * eventType.staffMembershipIds.length);
  return String(eventType.staffMembershipIds[index]);
}

export async function bookAppointment({ eventType, startAt, endAt, formResponses }: BookAppointmentInput) {
  const email = typeof formResponses.email === 'string' ? formResponses.email.trim() : undefined;
  const name = typeof formResponses.name === 'string' && formResponses.name.trim() ? formResponses.name.trim() : email ?? 'Booking';
  const phone = typeof formResponses.phone === 'string' ? formResponses.phone.trim() : undefined;

  let contact = email ? await Contact.findOne({ workspaceId: eventType.workspaceId, email }) : null;
  if (contact) {
    contact.attributionLatest = { source: 'Calendar', medium: eventType.name, date: new Date() };
    await contact.save();
  } else {
    contact = await Contact.create({
      workspaceId: eventType.workspaceId,
      name,
      email,
      phone,
      source: 'Calendar',
      lifecycleStage: 'Lead',
      attributionFirst: { source: 'Calendar', medium: eventType.name, date: new Date() },
      attributionLatest: { source: 'Calendar', medium: eventType.name, date: new Date() },
    });
  }

  const appointment = await Appointment.create({
    workspaceId: eventType.workspaceId,
    eventTypeId: eventType._id,
    contactId: contact._id,
    staffMembershipId: pickStaffMembershipId(eventType),
    startAt,
    endAt,
    status: eventType.requirePayment ? 'Awaiting Payment' : 'Booked',
    formResponses,
  });

  await TimelineEvent.create({
    workspaceId: eventType.workspaceId,
    contactId: contact._id,
    type: 'appointment_booked',
    message: `Booked "${eventType.name}" for ${startAt.toLocaleString()}.`,
    meta: { eventTypeId: String(eventType._id), appointmentId: String(appointment._id) },
  });

  emitPlatformEvent('calendar.appointmentBooked', {
    workspaceId: String(eventType.workspaceId),
    contactId: String(contact._id),
    eventTypeId: String(eventType._id),
    appointmentId: String(appointment._id),
  });

  return { appointment, contact };
}

const STATUS_EVENT: Partial<Record<AppointmentStatus, 'calendar.appointmentCancelled' | 'calendar.appointmentRescheduled' | 'calendar.noShow' | 'calendar.showUp'>> = {
  Cancelled: 'calendar.appointmentCancelled',
  Rescheduled: 'calendar.appointmentRescheduled',
  'No Show': 'calendar.noShow',
  'Show Up': 'calendar.showUp',
};

export function emitAppointmentStatusEvent(workspaceId: string, contactId: string, appointmentId: string, status: AppointmentStatus): void {
  const event = STATUS_EVENT[status];
  if (!event) return;
  emitPlatformEvent(event, { workspaceId, contactId, appointmentId });
}
