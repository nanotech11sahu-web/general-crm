import { Schema, model, Document, Types } from 'mongoose';

export const FINANCE_TRANSACTION_METHODS = ['razorpay', 'manual', 'wallet'] as const;
export type FinanceTransactionMethod = (typeof FINANCE_TRANSACTION_METHODS)[number];

export const FINANCE_TRANSACTION_STATUSES = ['success', 'refunded'] as const;
export type FinanceTransactionStatus = (typeof FINANCE_TRANSACTION_STATUSES)[number];

export interface IFinanceTransaction extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  contactId: Types.ObjectId;
  productId?: Types.ObjectId;
  amount: number;
  method: FinanceTransactionMethod;
  status: FinanceTransactionStatus;
  matched: boolean;
  resolved: boolean;
  note?: string;
  createdAt: Date;
}

const financeTransactionSchema = new Schema<IFinanceTransaction>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    amount: { type: Number, required: true },
    method: { type: String, enum: FINANCE_TRANSACTION_METHODS, default: 'manual' },
    status: { type: String, enum: FINANCE_TRANSACTION_STATUSES, default: 'success' },
    matched: { type: Boolean, default: true },
    resolved: { type: Boolean, default: false },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const FinanceTransaction = model<IFinanceTransaction>('FinanceTransaction', financeTransactionSchema);
