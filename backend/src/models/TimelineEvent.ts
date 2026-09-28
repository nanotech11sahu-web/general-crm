import { Schema, model, Document, Types } from 'mongoose';

export const TIMELINE_EVENT_TYPES = [
  'contact_created',
  'stage_changed',
  'note_added',
  'form_submitted',
  'appointment_booked',
  'email_sent',
  'whatsapp_sent',
  'call_logged',
  'invoice_created',
  'invoice_paid',
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export interface ITimelineEvent extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  type: TimelineEventType;
  message: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const timelineEventSchema = new Schema<ITimelineEvent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    type: { type: String, enum: TIMELINE_EVENT_TYPES, required: true },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const TimelineEvent = model<ITimelineEvent>('TimelineEvent', timelineEventSchema);
