import { Schema, model, Document, Types } from 'mongoose';

export interface ICourse extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  description: string;
  status: 'draft' | 'published';
  productId?: Types.ObjectId;
  thumbnailUrl?: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<ICourse>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    thumbnailUrl: { type: String },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Course = model<ICourse>('Course', courseSchema);
