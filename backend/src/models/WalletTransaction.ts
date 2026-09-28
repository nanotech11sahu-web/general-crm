import { Schema, model, Document, Types } from 'mongoose';

export const WALLET_TRANSACTION_REASONS = [
  'top_up',
  'vibe_prospecting_search',
  'waba_billing',
  'ai_gateway_usage',
  'refund',
  'manual_adjustment',
] as const;
export type WalletTransactionReason = (typeof WALLET_TRANSACTION_REASONS)[number];

export interface IWalletTransaction extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  walletId: Types.ObjectId;
  type: 'credit' | 'debit';
  amount: number;
  reason: WalletTransactionReason;
  description?: string;
  balanceAfter: number;
  createdAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, enum: WALLET_TRANSACTION_REASONS, required: true },
    description: { type: String },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const WalletTransaction = model<IWalletTransaction>('WalletTransaction', walletTransactionSchema);
