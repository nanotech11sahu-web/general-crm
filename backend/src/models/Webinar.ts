import { Schema, model, Document, Types } from 'mongoose';

export const WEBINAR_STATUSES = ['draft', 'scheduled', 'completed', 'cancelled'] as const;
export type WebinarStatus = (typeof WEBINAR_STATUSES)[number];

export interface IWebinar extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  topic: string;
  description?: string;
  coverImage?: string;
  scheduleType: 'one_time' | 'recurring';
  startAt: Date;
  durationMinutes: number;
  timezone: string;
  recurrence?: string;
  options: {
    requireRegistration: boolean;
    restrictToRegistered: boolean;
    enableRecording: boolean;
    enableQnA: boolean;
    enablePolls: boolean;
    enableChat: boolean;
    altHostEmails: string[];
  };
  registration: {
    mode: 'built_in' | 'site_funnel' | 'external';
    externalUrl?: string;
    funnelId?: string;
  };
  status: WebinarStatus;
  joinLink?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const webinarSchema = new Schema<IWebinar>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    topic: { type: String, required: true, trim: true },
    description: { type: String },
    coverImage: { type: String },
    scheduleType: { type: String, enum: ['one_time', 'recurring'], default: 'one_time' },
    startAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 60 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    recurrence: { type: String },
    options: {
      requireRegistration: { type: Boolean, default: true },
      restrictToRegistered: { type: Boolean, default: true },
      enableRecording: { type: Boolean, default: true },
      enableQnA: { type: Boolean, default: true },
      enablePolls: { type: Boolean, default: false },
      enableChat: { type: Boolean, default: true },
      altHostEmails: [{ type: String }],
    },
    registration: {
      mode: { type: String, enum: ['built_in', 'site_funnel', 'external'], default: 'built_in' },
      externalUrl: { type: String },
      funnelId: { type: Schema.Types.ObjectId, ref: 'Funnel' },
    },
    status: { type: String, enum: WEBINAR_STATUSES, default: 'draft' },
    joinLink: { type: String },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export const Webinar = model<IWebinar>('Webinar', webinarSchema);
