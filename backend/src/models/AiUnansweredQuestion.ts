import { Schema, model, Document, Types } from 'mongoose';

export interface IAiUnansweredQuestion extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  packKey: string;
  question: string;
  resolved: boolean;
  createdAt: Date;
}

const aiUnansweredQuestionSchema = new Schema<IAiUnansweredQuestion>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    packKey: { type: String, required: true, index: true },
    question: { type: String, required: true },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AiUnansweredQuestion = model<IAiUnansweredQuestion>('AiUnansweredQuestion', aiUnansweredQuestionSchema);
