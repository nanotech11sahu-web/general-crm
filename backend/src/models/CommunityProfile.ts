import { Schema, model, Document, Types } from 'mongoose';

export const PORTAL_MODULE_KEYS = ['courses', 'events', 'communityFeed', 'chatGroups', 'members', 'leaderboard', 'successHabits', 'billing'] as const;
export type PortalModuleKey = (typeof PORTAL_MODULE_KEYS)[number];

export interface IPortalModule {
  key: PortalModuleKey;
  enabled: boolean;
}

export interface ICommunityProfile extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  identity: { name: string; tagline?: string };
  images: { logoUrl?: string; bannerUrl?: string; loginBannerUrl?: string; faviconUrl?: string };
  portalModules: IPortalModule[];
  defaultLandingModule: PortalModuleKey;
  advanced: { seoTitle?: string; seoDescription?: string; customScripts?: string };
  createdAt: Date;
  updatedAt: Date;
}

const communityProfileSchema = new Schema<ICommunityProfile>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    identity: {
      name: { type: String, default: 'My Community' },
      tagline: { type: String },
    },
    images: {
      logoUrl: String,
      bannerUrl: String,
      loginBannerUrl: String,
      faviconUrl: String,
    },
    portalModules: {
      type: [{ key: { type: String, enum: PORTAL_MODULE_KEYS }, enabled: { type: Boolean, default: true }, _id: false }],
      default: () => PORTAL_MODULE_KEYS.map((key) => ({ key, enabled: true })),
    },
    defaultLandingModule: { type: String, enum: PORTAL_MODULE_KEYS, default: 'courses' },
    advanced: {
      seoTitle: String,
      seoDescription: String,
      customScripts: String,
    },
  },
  { timestamps: true },
);

export const CommunityProfile = model<ICommunityProfile>('CommunityProfile', communityProfileSchema);
