import { Schema, model, Document, Types } from 'mongoose';

export const TEMPLATE_CATEGORIES = ['Notes', 'Outreach', 'Email', 'WhatsApp', 'WhatsApp Business', 'Follow-up'] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface IContentTemplate extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  category: TemplateCategory;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const contentTemplateSchema = new Schema<IContentTemplate>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    category: { type: String, enum: TEMPLATE_CATEGORIES, required: true },
    name: { type: String, required: true, trim: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

export const ContentTemplate = model<IContentTemplate>('ContentTemplate', contentTemplateSchema);
