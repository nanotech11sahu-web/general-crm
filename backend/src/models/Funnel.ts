import { Schema, model, Document, Types } from 'mongoose';
import crypto from 'crypto';

export interface IFunnelBlock {
  id: string;
  type: 'heading' | 'text' | 'image' | 'cta' | 'divider';
  content: string;
  href?: string;
}

export interface IFunnelPage {
  id: string;
  name: string;
  path: string;
  isHome: boolean;
  status: 'draft' | 'active';
  blocks: IFunnelBlock[];
}

export interface IFunnelSettings {
  domain?: string;
  favicon?: string;
  trackingHeader?: string;
  trackingBody?: string;
  chatWidgetId?: Types.ObjectId;
  surveyEmbedId?: string;
  robotsTxtEnabled: boolean;
  sitemapEnabled: boolean;
}

export interface IFunnel extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  type: string;
  publicId: string;
  isOnline: boolean;
  pages: IFunnelPage[];
  settings: IFunnelSettings;
  publishedAt?: Date;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const blockSchema = new Schema<IFunnelBlock>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['heading', 'text', 'image', 'cta', 'divider'], required: true },
    content: { type: String, default: '' },
    href: { type: String },
  },
  { _id: false },
);

const pageSchema = new Schema<IFunnelPage>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    path: { type: String, required: true },
    isHome: { type: Boolean, default: false },
    status: { type: String, enum: ['draft', 'active'], default: 'draft' },
    blocks: { type: [blockSchema], default: [] },
  },
  { _id: false },
);

const funnelSchema = new Schema<IFunnel>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, default: 'Website' },
    publicId: { type: String, required: true, unique: true, default: () => crypto.randomBytes(6).toString('hex') },
    isOnline: { type: Boolean, default: true },
    pages: { type: [pageSchema], default: [] },
    settings: {
      domain: { type: String },
      favicon: { type: String },
      trackingHeader: { type: String },
      trackingBody: { type: String },
      chatWidgetId: { type: Schema.Types.ObjectId, ref: 'ChatWidget' },
      surveyEmbedId: { type: String },
      robotsTxtEnabled: { type: Boolean, default: true },
      sitemapEnabled: { type: Boolean, default: true },
    },
    publishedAt: { type: Date },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Funnel = model<IFunnel>('Funnel', funnelSchema);
