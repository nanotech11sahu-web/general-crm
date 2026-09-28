import { Schema, model, Document, Types } from 'mongoose';
import { SocialPlatform } from './SocialChannel';

export const SOCIAL_POST_STATUSES = [
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'partially_published',
  'failed',
  'rejected',
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export interface ISocialPost extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  content: string;
  channels: SocialPlatform[];
  status: SocialPostStatus;
  scheduledAt?: Date;
  publishedAt?: Date;
  reach: number;
  engagement: number;
  createdAt: Date;
}

const socialPostSchema = new Schema<ISocialPost>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    content: { type: String, required: true },
    channels: [{ type: String, enum: ['instagram', 'facebook', 'linkedin', 'twitter'] }],
    status: { type: String, enum: SOCIAL_POST_STATUSES, default: 'draft' },
    scheduledAt: { type: Date },
    publishedAt: { type: Date },
    reach: { type: Number, default: 0 },
    engagement: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SocialPost = model<ISocialPost>('SocialPost', socialPostSchema);
