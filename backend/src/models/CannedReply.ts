import { Schema, model, Document, Types } from 'mongoose';

export interface ICannedReply extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const cannedReplySchema = new Schema<ICannedReply>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true },
  },
  { timestamps: true },
);

export const CannedReply = model<ICannedReply>('CannedReply', cannedReplySchema);
