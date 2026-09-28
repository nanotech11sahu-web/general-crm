import { Schema, model, Document, Types } from 'mongoose';

export const TAG_OBJECT_TYPES = ['Contact', 'Task', 'Project', 'Deal', 'Ticket'] as const;
export type TagObjectType = (typeof TAG_OBJECT_TYPES)[number];

export interface ITag extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  color: string;
  appliesTo: TagObjectType[];
  usageCount: number;
  category?: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const tagSchema = new Schema<ITag>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: '#64748b' },
    appliesTo: [{ type: String, enum: TAG_OBJECT_TYPES }],
    usageCount: { type: Number, default: 0 },
    category: { type: String, trim: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

tagSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const Tag = model<ITag>('Tag', tagSchema);
