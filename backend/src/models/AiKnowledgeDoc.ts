import { Schema, model, Document, Types } from 'mongoose';

export const AI_KNOWLEDGE_TYPES = ['seeded', 'memory', 'document', 'faq'] as const;
export type AiKnowledgeType = (typeof AI_KNOWLEDGE_TYPES)[number];

export interface IAiKnowledgeDoc extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  packKey: string;
  type: AiKnowledgeType;
  title: string;
  content: string;
  createdAt: Date;
}

const aiKnowledgeDocSchema = new Schema<IAiKnowledgeDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    packKey: { type: String, required: true, index: true },
    type: { type: String, enum: AI_KNOWLEDGE_TYPES, default: 'memory' },
    title: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

aiKnowledgeDocSchema.index({ workspaceId: 1, packKey: 1 });

export const AiKnowledgeDoc = model<IAiKnowledgeDoc>('AiKnowledgeDoc', aiKnowledgeDocSchema);
