import { Schema, model, Document, Types } from 'mongoose';

export interface IDeletedItem extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  module: string;
  originalCollection: string;
  originalId: Types.ObjectId;
  snapshot: Record<string, unknown>;
  deletedBy: Types.ObjectId;
  deletedAt: Date;
  purgeAt: Date;
  restored: boolean;
}

const deletedItemSchema = new Schema<IDeletedItem>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    module: { type: String, required: true },
    originalCollection: { type: String, required: true },
    originalId: { type: Schema.Types.ObjectId, required: true },
    snapshot: { type: Schema.Types.Mixed, required: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: () => new Date() },
    purgeAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    restored: { type: Boolean, default: false },
  },
  { timestamps: false },
);

deletedItemSchema.index({ purgeAt: 1 });

export const DeletedItem = model<IDeletedItem>('DeletedItem', deletedItemSchema);
