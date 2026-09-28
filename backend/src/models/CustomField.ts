import { Schema, model, Document, Types } from 'mongoose';

export const CUSTOM_FIELD_TYPES = [
  'single_line',
  'multi_line',
  'phone',
  'dropdown_single',
  'date_picker',
  'file_upload',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface ICustomField extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  objectType: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  folder?: string;
  order: number;
  isStandard: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customFieldSchema = new Schema<ICustomField>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    objectType: { type: String, required: true, index: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: CUSTOM_FIELD_TYPES, required: true },
    options: [{ type: String }],
    required: { type: Boolean, default: false },
    folder: { type: String },
    order: { type: Number, default: 0 },
    isStandard: { type: Boolean, default: false },
  },
  { timestamps: true },
);

customFieldSchema.index({ workspaceId: 1, objectType: 1, label: 1 }, { unique: true });

export const CustomField = model<ICustomField>('CustomField', customFieldSchema);
