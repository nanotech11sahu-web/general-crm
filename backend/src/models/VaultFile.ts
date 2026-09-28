import { Schema, model, Document, Types } from 'mongoose';

export interface IVaultFile extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  folder: string;
  filename: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

const vaultFileSchema = new Schema<IVaultFile>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    folder: { type: String, default: 'General' },
    filename: { type: String, required: true },
    url: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    mimeType: { type: String, required: true },
  },
  { timestamps: true },
);

export const VaultFile = model<IVaultFile>('VaultFile', vaultFileSchema);
