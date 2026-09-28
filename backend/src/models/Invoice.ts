import { Schema, model, Document, Types } from 'mongoose';

export const INVOICE_STATUSES = ['open', 'paid', 'overdue', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface IInvoice extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  productId: Types.ObjectId;
  subscriptionId?: Types.ObjectId;
  receiptNumber: string;
  amount: number;
  discount: number;
  tax: number;
  totalAmount: number;
  paidAmount: number;
  status: InvoiceStatus;
  dueAt: Date;
  paidAt?: Date;
  installmentNumber?: number;
  installmentsTotal?: number;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: 'Subscription' },
    receiptNumber: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0 },
    status: { type: String, enum: INVOICE_STATUSES, default: 'open', index: true },
    dueAt: { type: Date, required: true },
    paidAt: { type: Date },
    installmentNumber: { type: Number },
    installmentsTotal: { type: Number },
  },
  { timestamps: true },
);

export const Invoice = model<IInvoice>('Invoice', invoiceSchema);
