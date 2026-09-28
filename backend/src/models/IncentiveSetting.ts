import { Schema, model, Document, Types } from 'mongoose';

export interface IIncentiveSetting extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  membershipId: Types.ObjectId;
  incentiveAmount: number;
  notes?: string;
  updatedAt: Date;
}

const incentiveSettingSchema = new Schema<IIncentiveSetting>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'Membership', required: true },
    incentiveAmount: { type: Number, default: 0 },
    notes: { type: String },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

incentiveSettingSchema.index({ workspaceId: 1, membershipId: 1 }, { unique: true });

export const IncentiveSetting = model<IIncentiveSetting>('IncentiveSetting', incentiveSettingSchema);
