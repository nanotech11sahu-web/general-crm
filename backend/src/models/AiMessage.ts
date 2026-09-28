import { Schema, model, Document, Types } from 'mongoose';

export interface IAiMessage extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  threadKey: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

const aiMessageSchema = new Schema<IAiMessage>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    threadKey: { type: String, required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AiMessage = model<IAiMessage>('AiMessage', aiMessageSchema);
