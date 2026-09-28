import { Schema, model, Document, Types } from 'mongoose';

export const AI_PROVIDERS = ['gemini', 'openai', 'claude', 'deepseek', 'xai'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface IAiProviderConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  provider: AiProvider;
  connected: boolean;
  apiKeyMasked?: string;
  connectedAt?: Date;
}

const aiProviderConnectionSchema = new Schema<IAiProviderConnection>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  provider: { type: String, enum: AI_PROVIDERS, required: true },
  connected: { type: Boolean, default: false },
  apiKeyMasked: { type: String },
  connectedAt: { type: Date },
});

aiProviderConnectionSchema.index({ workspaceId: 1, provider: 1 }, { unique: true });

export const AiProviderConnection = model<IAiProviderConnection>('AiProviderConnection', aiProviderConnectionSchema);
