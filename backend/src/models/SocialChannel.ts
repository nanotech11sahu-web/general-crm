import { Schema, model, Document, Types } from 'mongoose';

export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'twitter'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export interface ISocialChannel extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  platform: SocialPlatform;
  status: 'connected' | 'expiring_soon' | 'expired' | 'not_connected';
  connectedAt?: Date;
}

const socialChannelSchema = new Schema<ISocialChannel>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    status: { type: String, enum: ['connected', 'expiring_soon', 'expired', 'not_connected'], default: 'not_connected' },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

socialChannelSchema.index({ workspaceId: 1, platform: 1 }, { unique: true });

export const SocialChannel = model<ISocialChannel>('SocialChannel', socialChannelSchema);
