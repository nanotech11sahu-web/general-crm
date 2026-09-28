import { Schema, model, Document, Types } from 'mongoose';

export interface ICommunityOrder extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  productId: Types.ObjectId;
  amount: number;
  couponCode?: string;
  transactionId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const communityOrderSchema = new Schema<ICommunityOrder>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    amount: { type: Number, required: true, min: 0 },
    couponCode: { type: String },
    transactionId: { type: Schema.Types.ObjectId, ref: 'FinanceTransaction' },
  },
  { timestamps: true },
);

export const CommunityOrder = model<ICommunityOrder>('CommunityOrder', communityOrderSchema);
