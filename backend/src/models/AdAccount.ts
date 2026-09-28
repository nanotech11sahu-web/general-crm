import { Schema, model, Document, Types } from 'mongoose';

export const AD_PLATFORMS = ['meta', 'google', 'linkedin'] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export interface IAdAccount extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  platform: AdPlatform;
  status: 'not_connected' | 'connected';
  externalAccountId?: string;
  accountName?: string;
  /** AES-256-GCM encrypted long-lived access token. Never expose this field to the API response. */
  accessTokenEncrypted?: string;
  tokenExpiresAt?: Date;
  connectedAt?: Date;
}

const adAccountSchema = new Schema<IAdAccount>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    platform: { type: String, enum: AD_PLATFORMS, required: true },
    status: { type: String, enum: ['not_connected', 'connected'], default: 'not_connected' },
    externalAccountId: { type: String },
    accountName: { type: String },
    accessTokenEncrypted: { type: String, select: false },
    tokenExpiresAt: { type: Date },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

adAccountSchema.index({ workspaceId: 1, platform: 1 }, { unique: true });

export const AdAccount = model<IAdAccount>('AdAccount', adAccountSchema);
