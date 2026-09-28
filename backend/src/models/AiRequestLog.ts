import { Schema, model, Document, Types } from 'mongoose';

export const AI_REQUEST_PURPOSES = [
  'nextBestAction',
  'storeBuilder',
  'formBuilder',
  'emailCompose',
  'brainChat',
  'agentInvoke',
] as const;
export type AiRequestPurpose = (typeof AI_REQUEST_PURPOSES)[number];

export interface IAiRequestLog extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  purpose: AiRequestPurpose;
  provider: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  latencyMs: number;
  cacheHit: boolean;
  success: boolean;
  createdAt: Date;
}

const aiRequestLogSchema = new Schema<IAiRequestLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    purpose: { type: String, enum: AI_REQUEST_PURPOSES, required: true },
    provider: { type: String, required: true },
    modelName: { type: String, required: true },
    promptTokens: { type: Number, required: true },
    completionTokens: { type: Number, required: true },
    totalTokens: { type: Number, required: true },
    costEstimate: { type: Number, required: true },
    latencyMs: { type: Number, required: true },
    cacheHit: { type: Boolean, default: false },
    success: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const AiRequestLog = model<IAiRequestLog>('AiRequestLog', aiRequestLogSchema);
