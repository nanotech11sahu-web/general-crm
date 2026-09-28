import { Schema, model, Document, Types } from 'mongoose';

export interface IWallet extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  balance: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'credits' },
  },
  { timestamps: true },
);

export const Wallet = model<IWallet>('Wallet', walletSchema);
