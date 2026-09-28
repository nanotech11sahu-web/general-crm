import { Schema, model, Document, Types } from 'mongoose';

export const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'END'] as const;

export interface IOptOut extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  channel: 'whatsapp' | 'email';
  keyword: string;
  createdAt: Date;
}

const optOutSchema = new Schema<IOptOut>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'email'], required: true },
    keyword: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

optOutSchema.index({ workspaceId: 1, contactId: 1, channel: 1 }, { unique: true });

export const OptOut = model<IOptOut>('OptOut', optOutSchema);
