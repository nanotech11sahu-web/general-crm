import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { getOrCreateWallet, creditWallet, listWalletTransactions } from '../services/wallet.service';

export const walletRouter = Router();

walletRouter.use(authenticate);

walletRouter.get('/', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const wallet = await getOrCreateWallet(req.auth!.workspaceId);
    const transactions = await listWalletTransactions(req.auth!.workspaceId, 20);
    res.json({ wallet, transactions });
  } catch (err) {
    next(err);
  }
});

const topUpSchema = z.object({ amount: z.number().positive() });

walletRouter.post('/top-up', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = topUpSchema.parse(req.body);
    const result = await creditWallet(req.auth!.workspaceId, body.amount, 'top_up', 'Manual top-up');
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
