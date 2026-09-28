import { Schema, model, Document, Types } from 'mongoose';

export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'overdue', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface ISubscription extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  productId: Types.ObjectId;
  billingCycle: BillingCycle;
  price: number;
  status: SubscriptionStatus;
  startedAt: Date;
  nextBillingAt: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    billingCycle: { type: String, enum: BILLING_CYCLES, default: 'monthly' },
    price: { type: Number, required: true, min: 0 },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'active' },
    startedAt: { type: Date, default: () => new Date() },
    nextBillingAt: { type: Date, required: true },
    cancelledAt: { type: Date },
  },
  { timestamps: true },
);

export const Subscription = model<ISubscription>('Subscription', subscriptionSchema);
