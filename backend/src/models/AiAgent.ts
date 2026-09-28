import { Schema, model, Document, Types } from 'mongoose';

export interface IAiAgent extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  templateKey: string;
  tone: string;
  systemInstructions: string;
  guardrails: string[];
  includedSkills: string[];
  status: 'active' | 'draft';
  createdAt: Date;
}

const aiAgentSchema = new Schema<IAiAgent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    templateKey: { type: String, required: true },
    tone: { type: String, default: '' },
    systemInstructions: { type: String, default: '' },
    guardrails: [{ type: String }],
    includedSkills: [{ type: String }],
    status: { type: String, enum: ['active', 'draft'], default: 'active' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AiAgent = model<IAiAgent>('AiAgent', aiAgentSchema);
