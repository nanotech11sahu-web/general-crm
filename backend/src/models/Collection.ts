import { Schema, model, Document, Types } from 'mongoose';

export interface ICollection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
}

const collectionSchema = new Schema<ICollection>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

collectionSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });

export const Collection = model<ICollection>('Collection', collectionSchema);
