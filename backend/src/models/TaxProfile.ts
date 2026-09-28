import { Schema, model, Document, Types } from 'mongoose';

export interface ITaxProfile extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  ratePercent: number;
  isDefault: boolean;
  createdAt: Date;
}

const taxProfileSchema = new Schema<ITaxProfile>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true },
    ratePercent: { type: Number, required: true, min: 0 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

taxProfileSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const TaxProfile = model<ITaxProfile>('TaxProfile', taxProfileSchema);
