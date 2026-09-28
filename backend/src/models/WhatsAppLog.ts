import { Schema, model, Document, Types } from 'mongoose';

export interface IWhatsAppLog extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  message: string;
  status: 'sent' | 'suppressed_dnd' | 'suppressed_optout';
  source: 'campaign' | 'workflow' | 'test' | 'inbox';
  createdAt: Date;
}

const whatsAppLogSchema = new Schema<IWhatsAppLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['sent', 'suppressed_dnd', 'suppressed_optout'], required: true },
    source: { type: String, enum: ['campaign', 'workflow', 'test', 'inbox'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const WhatsAppLog = model<IWhatsAppLog>('WhatsAppLog', whatsAppLogSchema);
