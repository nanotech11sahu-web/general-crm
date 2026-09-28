import { Schema, model, Document, Types } from 'mongoose';

export interface IEmailLog extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  campaignId?: Types.ObjectId;
  contactId: Types.ObjectId;
  subject: string;
  status: 'sent' | 'suppressed_dnd' | 'suppressed_optout';
  source: 'campaign' | 'workflow' | 'test' | 'inbox';
  createdAt: Date;
}

const emailLogSchema = new Schema<IEmailLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'EmailCampaign' },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ['sent', 'suppressed_dnd', 'suppressed_optout'], required: true },
    source: { type: String, enum: ['campaign', 'workflow', 'test', 'inbox'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const EmailLog = model<IEmailLog>('EmailLog', emailLogSchema);
