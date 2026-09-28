import { Schema, model, Document, Types } from 'mongoose';

export interface IWorkspace extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  ownerUserId: Types.ObjectId;
  agencyId?: Types.ObjectId;
  timezone: string;
  branding: {
    logoLight?: string;
    logoDark?: string;
    favicon?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', index: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    branding: {
      logoLight: { type: String },
      logoDark: { type: String },
      favicon: { type: String },
    },
  },
  { timestamps: true },
);

export const Workspace = model<IWorkspace>('Workspace', workspaceSchema);
