import { Schema, model, Document, Types } from 'mongoose';

export interface IBulkCampaign extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  channels: ('email' | 'whatsapp')[];
  status: 'draft' | 'scheduled' | 'running' | 'completed';
  emailSubject?: string;
  message?: string;
  scheduledAt?: Date;
  recipientCount: number;
  sentCount: number;
  createdAt: Date;
}

const bulkCampaignSchema = new Schema<IBulkCampaign>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    channels: [{ type: String, enum: ['email', 'whatsapp'] }],
    status: { type: String, enum: ['draft', 'scheduled', 'running', 'completed'], default: 'draft' },
    emailSubject: { type: String },
    message: { type: String },
    scheduledAt: { type: Date },
    recipientCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const BulkCampaign = model<IBulkCampaign>('BulkCampaign', bulkCampaignSchema);
