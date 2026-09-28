import { Schema, model, Document, Types } from 'mongoose';

export interface IEmailCampaign extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  bodyPreview: string;
  status: 'draft' | 'sent';
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  unsubscribedCount: number;
  sentAt?: Date;
  createdAt: Date;
}

const emailCampaignSchema = new Schema<IEmailCampaign>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true },
    fromName: { type: String, default: '' },
    fromEmail: { type: String, default: '' },
    bodyPreview: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'sent'], default: 'draft' },
    sentCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    openedCount: { type: Number, default: 0 },
    clickedCount: { type: Number, default: 0 },
    bouncedCount: { type: Number, default: 0 },
    unsubscribedCount: { type: Number, default: 0 },
    sentAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const EmailCampaign = model<IEmailCampaign>('EmailCampaign', emailCampaignSchema);
