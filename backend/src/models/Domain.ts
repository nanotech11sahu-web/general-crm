import { Schema, model, Document, Types } from 'mongoose';

export interface IDomain extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  hostname: string;
  verified: boolean;
  createdAt: Date;
}

const domainSchema = new Schema<IDomain>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    hostname: { type: String, required: true, lowercase: true, trim: true },
    verified: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

domainSchema.index({ workspaceId: 1, hostname: 1 }, { unique: true });

export const Domain = model<IDomain>('Domain', domainSchema);
