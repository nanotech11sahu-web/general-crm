import { Schema, model, Document, Types } from 'mongoose';

export const SALES_ACTIVITY_TYPES = ['call', 'action', 'revenue', 'response'] as const;
export type SalesActivityType = (typeof SALES_ACTIVITY_TYPES)[number];

export interface ISalesActivity extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  membershipId: Types.ObjectId;
  type: SalesActivityType;
  amount?: number;
  responseTimeSeconds?: number;
  note?: string;
  createdAt: Date;
}

const salesActivitySchema = new Schema<ISalesActivity>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'Membership', required: true, index: true },
    type: { type: String, enum: SALES_ACTIVITY_TYPES, required: true },
    amount: { type: Number },
    responseTimeSeconds: { type: Number },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SalesActivity = model<ISalesActivity>('SalesActivity', salesActivitySchema);
