import { Schema, model, Document, Types } from 'mongoose';

export interface IWabaTemplate extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  body: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
  createdAt: Date;
}

const wabaTemplateSchema = new Schema<IWabaTemplate>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['draft', 'pending_approval', 'approved', 'rejected'], default: 'draft' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

wabaTemplateSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const WabaTemplate = model<IWabaTemplate>('WabaTemplate', wabaTemplateSchema);
