import { Schema, model, Document, Types } from 'mongoose';

export const APPOINTMENT_STATUSES = ['Booked', 'Awaiting Payment', 'Cancelled', 'Show Up', 'No Show', 'Rescheduled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface IAppointment extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  eventTypeId: Types.ObjectId;
  contactId: Types.ObjectId;
  staffMembershipId?: Types.ObjectId;
  startAt: Date;
  endAt: Date;
  status: AppointmentStatus;
  formResponses: Record<string, unknown>;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    eventTypeId: { type: Schema.Types.ObjectId, ref: 'EventType', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    staffMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership' },
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'Booked' },
    formResponses: { type: Schema.Types.Mixed, default: {} },
    notes: { type: String },
  },
  { timestamps: true },
);

export const Appointment = model<IAppointment>('Appointment', appointmentSchema);
