import { Schema, model, Document, Types } from 'mongoose';

export interface IBrandingSettings extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  logoLightUrl?: string;
  logoDarkUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  loaderText?: string;
  mobileNavLocked: boolean;
  experienceName: string;
  createdAt: Date;
  updatedAt: Date;
}

const brandingSettingsSchema = new Schema<IBrandingSettings>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    logoLightUrl: { type: String },
    logoDarkUrl: { type: String },
    faviconUrl: { type: String },
    primaryColor: { type: String, default: '#4f46e5' },
    loaderText: { type: String, default: 'Loading…' },
    mobileNavLocked: { type: Boolean, default: false },
    experienceName: { type: String, default: 'PMC Demo' },
  },
  { timestamps: true },
);

export const BrandingSettings = model<IBrandingSettings>('BrandingSettings', brandingSettingsSchema);
