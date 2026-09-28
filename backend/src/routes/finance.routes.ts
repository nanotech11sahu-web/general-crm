import { Router } from 'express';
import { z } from 'zod';
import { Invoice } from '../models/Invoice';
import { Subscription } from '../models/Subscription';
import { FinanceTransaction } from '../models/FinanceTransaction';
import { TaxProfile } from '../models/TaxProfile';
import { Product } from '../models/Product';
import { RazorpayConnection } from '../models/RazorpayConnection';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import {
  computeDashboard,
  createInvoice,
  markInvoicePaid,
  markInvoiceOverdue,
  createSubscription,
  cancelSubscription,
  recordOneTimeTransaction,
  resolveTransaction,
  refundTransaction,
} from '../services/finance.service';

export const financeRouter = Router();

financeRouter.use(authenticate);

financeRouter.get('/dashboard', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const dashboard = await computeDashboard(req.auth!.workspaceId);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

// --- Products: single shared object across Ecom/Community/Store (Appendix A) ---
financeRouter.get('/products', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const products = await Product.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// --- Tax profiles (moved here from Ecom per Phase 6 spec; Ecom's dropdown reads from this) ---
financeRouter.get('/tax-profiles', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const profiles = await TaxProfile.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: 1 }).lean();
    res.json({ profiles });
  } catch (err) {
    next(err);
  }
});

const taxProfileSchema = z.object({ name: z.string().min(1), ratePercent: z.number().min(0), isDefault: z.boolean().optional() });

financeRouter.post('/tax-profiles', requirePermission('finance', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = taxProfileSchema.parse(req.body);
    if (body.isDefault) {
      await TaxProfile.updateMany({ workspaceId: req.auth!.workspaceId }, { $set: { isDefault: false } });
    }
    const profile = await TaxProfile.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ profile });
  } catch (err) {
    next(err);
  }
});

// --- Razorpay connect stub ---
financeRouter.get('/razorpay-status', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connection = await RazorpayConnection.findOne({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ connected: connection?.connected ?? false, accountEmail: connection?.accountEmail });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/razorpay-connect', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connection = await RazorpayConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { connected: true, accountEmail: `${req.auth!.userId}@razorpay.stub`, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ connected: connection.connected, accountEmail: connection.accountEmail });
  } catch (err) {
    next(err);
  }
});

// --- Subscriptions ---
financeRouter.get('/subscriptions', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.contactId) query.contactId = req.query.contactId;
    const subscriptions = await Subscription.find(query).sort({ createdAt: -1 }).lean();
    res.json({ subscriptions });
  } catch (err) {
    next(err);
  }
});

const createSubscriptionSchema = z.object({
  contactId: z.string().min(1),
  productId: z.string().min(1),
  billingCycle: z.enum(['monthly', 'yearly']),
  price: z.number().min(0),
});

financeRouter.post('/subscriptions', requirePermission('finance', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createSubscriptionSchema.parse(req.body);
    const subscription = await createSubscription({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ subscription });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/subscriptions/:id/cancel', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const subscription = await cancelSubscription(req.auth!.workspaceId, req.params.id);
    if (!subscription) throw new HttpError(404, 'Subscription not found');
    res.json({ subscription });
  } catch (err) {
    next(err);
  }
});

// --- Invoices ---
financeRouter.get('/invoices', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.status) query.status = req.query.status;
    if (req.query.contactId) query.contactId = req.query.contactId;
    if (req.query.dueBefore) query.dueAt = { $lte: new Date(String(req.query.dueBefore)) };
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(query),
    ]);
    res.json({ invoices, total, page, limit });
  } catch (err) {
    next(err);
  }
});

const createInvoiceSchema = z.object({
  contactId: z.string().min(1),
  productId: z.string().min(1),
  subscriptionId: z.string().optional(),
  amount: z.number().min(0),
  discount: z.number().min(0).optional(),
  tax: z.number().min(0).optional(),
  dueAt: z.string(),
  installmentNumber: z.number().optional(),
  installmentsTotal: z.number().optional(),
});

financeRouter.post('/invoices', requirePermission('finance', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createInvoiceSchema.parse(req.body);
    const invoice = await createInvoice({ workspaceId: req.auth!.workspaceId, ...body, dueAt: new Date(body.dueAt) });
    res.status(201).json({ invoice });
  } catch (err) {
    next(err);
  }
});

const markPaidSchema = z.object({ paidAmount: z.number().min(0).optional() });

financeRouter.post('/invoices/:id/mark-paid', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = markPaidSchema.parse(req.body ?? {});
    const result = await markInvoicePaid(req.auth!.workspaceId, req.params.id, body.paidAmount);
    if (!result) throw new HttpError(404, 'Invoice not found');
    res.json(result);
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/invoices/:id/mark-overdue', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const invoice = await markInvoiceOverdue(req.auth!.workspaceId, req.params.id);
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/invoices/:id/cancel', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const invoice = await Invoice.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: 'cancelled' } },
      { new: true },
    );
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

// --- Transactions ---
financeRouter.get('/transactions', requirePermission('finance', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (req.query.unresolved === 'true') {
      query.matched = false;
      query.resolved = false;
    }
    const transactions = await FinanceTransaction.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ transactions });
  } catch (err) {
    next(err);
  }
});

const createTransactionSchema = z.object({
  contactId: z.string().min(1),
  productId: z.string().optional(),
  amount: z.number(),
  method: z.enum(['razorpay', 'manual', 'wallet']).optional(),
  forceMismatch: z.boolean().optional(),
});

financeRouter.post('/transactions', requirePermission('finance', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createTransactionSchema.parse(req.body);
    const transaction = await recordOneTimeTransaction({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ transaction });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/transactions/:id/resolve', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const transaction = await resolveTransaction(req.auth!.workspaceId, req.params.id);
    if (!transaction) throw new HttpError(404, 'Transaction not found');
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/transactions/:id/refund', requirePermission('finance', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const transaction = await refundTransaction(req.auth!.workspaceId, req.params.id);
    if (!transaction) throw new HttpError(404, 'Transaction not found');
    res.json({ transaction });
  } catch (err) {
    next(err);
  }
});
