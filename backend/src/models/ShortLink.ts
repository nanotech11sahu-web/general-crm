import { Schema, model, Document, Types } from 'mongoose';

export interface IShortLink extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  domainId: Types.ObjectId;
  linkType: string;
  redirectMode: '301' | '302';
  destinationUrl: string;
  title?: string;
  slug: string;
  utm: { source?: string; medium?: string; campaign?: string; term?: string; content?: string };
  attributionModel: string;
  cookieDurationDays: number;
  startsAt?: Date;
  expiresAt?: Date;
  tags: string[];
  clicks: number;
  uniqueClicks: number;
  createdAt: Date;
}

const shortLinkSchema = new Schema<IShortLink>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    domainId: { type: Schema.Types.ObjectId, ref: 'Domain', required: true },
    linkType: { type: String, default: 'Standard' },
    redirectMode: { type: String, enum: ['301', '302'], default: '302' },
    destinationUrl: { type: String, required: true },
    title: { type: String },
    slug: { type: String, required: true },
    utm: {
      source: String,
      medium: String,
      campaign: String,
      term: String,
      content: String,
    },
    attributionModel: { type: String, default: 'last_click' },
    cookieDurationDays: { type: Number, default: 30 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    tags: [{ type: String }],
    clicks: { type: Number, default: 0 },
    uniqueClicks: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

shortLinkSchema.index({ domainId: 1, slug: 1 }, { unique: true });

export const ShortLink = model<IShortLink>('ShortLink', shortLinkSchema);
