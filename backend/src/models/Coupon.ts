import { Schema, model, Document, Types } from 'mongoose';

export interface ICoupon extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  code: string;
  discountPercent: number;
  active: boolean;
  redemptions: number;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    active: { type: Boolean, default: true },
    redemptions: { type: Number, default: 0 },
  },
  { timestamps: true },
);

couponSchema.index({ workspaceId: 1, code: 1 }, { unique: true });

export const Coupon = model<ICoupon>('Coupon', couponSchema);
