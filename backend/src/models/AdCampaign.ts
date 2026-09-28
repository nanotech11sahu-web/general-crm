import { Schema, model, Document, Types } from 'mongoose';

export interface IAdCampaign extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  adAccountId: Types.ObjectId;
  name: string;
  status: 'active' | 'paused' | 'draft' | 'archived';
  spend: number;
  leads: number;
  clicks: number;
  impressions: number;
  createdAt: Date;
}

const adCampaignSchema = new Schema<IAdCampaign>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    adAccountId: { type: Schema.Types.ObjectId, ref: 'AdAccount', required: true, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ['active', 'paused', 'draft', 'archived'], default: 'draft' },
    spend: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AdCampaign = model<IAdCampaign>('AdCampaign', adCampaignSchema);
