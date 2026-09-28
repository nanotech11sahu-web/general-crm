import { Schema, model, Document, Types } from 'mongoose';

export interface IMetaAppConfig extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  appId: string;
  appSecretEncrypted: string;
  createdAt: Date;
  updatedAt: Date;
}

const metaAppConfigSchema = new Schema<IMetaAppConfig>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
    appId: { type: String, required: true },
    appSecretEncrypted: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

export const MetaAppConfig = model<IMetaAppConfig>('MetaAppConfig', metaAppConfigSchema);
