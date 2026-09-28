import { Types } from 'mongoose';
import { Wallet } from '../models/Wallet';
import { WalletTransaction, WalletTransactionReason } from '../models/WalletTransaction';
import { HttpError } from '../middleware/errorHandler';

export async function getOrCreateWallet(workspaceId: string | Types.ObjectId) {
  let wallet = await Wallet.findOne({ workspaceId });
  if (!wallet) {
    wallet = await Wallet.create({ workspaceId, balance: 0 });
  }
  return wallet;
}

export async function creditWallet(
  workspaceId: string | Types.ObjectId,
  amount: number,
  reason: WalletTransactionReason,
  description?: string,
) {
  if (amount <= 0) throw new HttpError(400, 'Credit amount must be positive');
  const wallet = await getOrCreateWallet(workspaceId);
  wallet.balance += amount;
  await wallet.save();
  const transaction = await WalletTransaction.create({
    workspaceId,
    walletId: wallet._id,
    type: 'credit',
    amount,
    reason,
    description,
    balanceAfter: wallet.balance,
  });
  return { wallet, transaction };
}

export async function debitWallet(
  workspaceId: string | Types.ObjectId,
  amount: number,
  reason: WalletTransactionReason,
  description?: string,
) {
  if (amount <= 0) throw new HttpError(400, 'Debit amount must be positive');
  const wallet = await getOrCreateWallet(workspaceId);
  if (wallet.balance < amount) {
    throw new HttpError(402, 'Insufficient wallet balance');
  }
  wallet.balance -= amount;
  await wallet.save();
  const transaction = await WalletTransaction.create({
    workspaceId,
    walletId: wallet._id,
    type: 'debit',
    amount,
    reason,
    description,
    balanceAfter: wallet.balance,
  });
  return { wallet, transaction };
}

export async function listWalletTransactions(workspaceId: string | Types.ObjectId, limit = 50) {
  return WalletTransaction.find({ workspaceId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}
