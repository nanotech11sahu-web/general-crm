import { Schema, model, Document, Types } from 'mongoose';

export const TEMPERATURES = ['Hot', 'Warm', 'Cold'] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const LIFECYCLE_STAGES = ['Lead', 'MQL', 'SQL', 'Opportunity', 'Customer', 'Evangelist'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export interface IAttribution {
  source?: string;
  medium?: string;
  campaign?: string;
  date?: Date;
}

export interface IContact extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  city?: string;
  country?: string;
  avatarUrl?: string;
  tagIds: Types.ObjectId[];
  customFieldValues: Map<string, unknown>;
  lifecycleStage: LifecycleStage;
  temperature: Temperature;
  contactType: string;
  leadValue?: number;
  attributionFirst?: IAttribution;
  attributionLatest?: IAttribution;
  assignedCloserIds: Types.ObjectId[];
  dnd: {
    email: boolean;
    whatsapp: boolean;
    waba: boolean;
    calls: boolean;
    blockAll: boolean;
  };
  aiPulseScore: number;
  leadScore: number;
  leadScoreUpdatedAt?: Date;
  source: string;
  isDemo: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const attributionSchema = new Schema<IAttribution>(
  {
    source: String,
    medium: String,
    campaign: String,
    date: Date,
  },
  { _id: false },
);

const contactSchema = new Schema<IContact>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    company: { type: String, trim: true },
    jobTitle: { type: String, trim: true },
    city: { type: String, trim: true },
    country: { type: String, trim: true },
    avatarUrl: String,
    tagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    customFieldValues: { type: Map, of: Schema.Types.Mixed, default: () => new Map() },
    lifecycleStage: { type: String, enum: LIFECYCLE_STAGES, default: 'Lead' },
    temperature: { type: String, enum: TEMPERATURES, default: 'Warm' },
    contactType: { type: String, default: 'Lead' },
    leadValue: { type: Number },
    attributionFirst: attributionSchema,
    attributionLatest: attributionSchema,
    assignedCloserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    dnd: {
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
      waba: { type: Boolean, default: false },
      calls: { type: Boolean, default: false },
      blockAll: { type: Boolean, default: false },
    },
    aiPulseScore: { type: Number, default: 0 },
    leadScore: { type: Number, default: 0 },
    leadScoreUpdatedAt: { type: Date },
    source: { type: String, default: 'Manual' },
    isDemo: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

contactSchema.index({ workspaceId: 1, archived: 1, createdAt: -1 });
contactSchema.index({ workspaceId: 1, email: 1 });

export const Contact = model<IContact>('Contact', contactSchema);
