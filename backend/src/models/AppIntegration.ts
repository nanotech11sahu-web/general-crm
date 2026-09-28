import { Schema, model, Document, Types } from 'mongoose';

export interface IAppIntegration extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  appKey: string;
  connected: boolean;
  config: Record<string, unknown>;
  connectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const appIntegrationSchema = new Schema<IAppIntegration>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    appKey: { type: String, required: true },
    connected: { type: Boolean, default: false },
    config: { type: Schema.Types.Mixed, default: {} },
    connectedAt: { type: Date },
  },
  { timestamps: true },
);

appIntegrationSchema.index({ workspaceId: 1, appKey: 1 }, { unique: true });

export const AppIntegration = model<IAppIntegration>('AppIntegration', appIntegrationSchema);
