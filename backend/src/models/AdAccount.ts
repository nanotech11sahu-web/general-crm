import { Schema, model, Document, Types } from 'mongoose';

export const AD_PLATFORMS = ['meta', 'google', 'linkedin'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export interface IAdAccount extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  platform: AdPlatform;
  status: 'not_connected' | 'connected';
  externalAccountId?: string;
  connectedAt?: Date;
}

const adAccountSchema = new Schema<IAdAccount>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    platform: { type: String, enum: AD_PLATFORMS, required: true },
    status: { type: String, enum: ['not_connected', 'connected'], default: 'not_connected' },
    externalAccountId: { type: String },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

adAccountSchema.index({ workspaceId: 1, platform: 1 }, { unique: true });

export const AdAccount = model<IAdAccount>('AdAccount', adAccountSchema);
