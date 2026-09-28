import { Schema, model, Document, Types } from 'mongoose';

export const FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'name',
  'single_choice',
  'multiple_choice',
  'dropdown',
  'submit',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface IFormField {
  id: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[];
}

export interface IForm extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  slug: string;
  status: 'draft' | 'published';
  fields: IFormField[];
  style: {
    pageBackground: string;
    cardBackground: string;
    buttonBackground: string;
    cornerRadius: number;
  };
  settings: {
    onSubmitAction: 'message' | 'redirect';
    onSubmitMessage: string;
    redirectUrl?: string;
    autoCreateContact: boolean;
    lifecycleStageOnSubmit: string;
    skipContactCreation: boolean;
    gdprConsent: boolean;
    requireCaptcha: boolean;
    rateLimitPerHour: number;
  };
  customDomain?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const fieldSchema = new Schema<IFormField>(
  {
    id: { type: String, required: true },
    type: { type: String, enum: FORM_FIELD_TYPES, required: true },
    label: { type: String, required: true },
    required: { type: Boolean, default: false },
    options: [{ type: String }],
  },
  { _id: false },
);

const formSchema = new Schema<IForm>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    fields: { type: [fieldSchema], default: [] },
    style: {
      pageBackground: { type: String, default: '#f8fafc' },
      cardBackground: { type: String, default: '#ffffff' },
      buttonBackground: { type: String, default: '#4f46e5' },
      cornerRadius: { type: Number, default: 10 },
    },
    settings: {
      onSubmitAction: { type: String, enum: ['message', 'redirect'], default: 'message' },
      onSubmitMessage: { type: String, default: 'Thanks! We received your submission.' },
      redirectUrl: { type: String },
      autoCreateContact: { type: Boolean, default: true },
      lifecycleStageOnSubmit: { type: String, default: 'Lead' },
      skipContactCreation: { type: Boolean, default: false },
      gdprConsent: { type: Boolean, default: false },
      requireCaptcha: { type: Boolean, default: false },
      rateLimitPerHour: { type: Number, default: 60 },
    },
    customDomain: { type: String },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

formSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });

export const Form = model<IForm>('Form', formSchema);
