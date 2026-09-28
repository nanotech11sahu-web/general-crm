import { Schema, model, Document, Types } from 'mongoose';

export const ANNOUNCEMENT_AUDIENCES = ['hrm', 'school'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export interface IAnnouncement extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  audience: AnnouncementAudience;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const announcementSchema = new Schema<IAnnouncement>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    audience: { type: String, enum: ANNOUNCEMENT_AUDIENCES, required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

export const Announcement = model<IAnnouncement>('Announcement', announcementSchema);
