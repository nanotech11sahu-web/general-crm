import crypto from 'crypto';
import { Types } from 'mongoose';
import { Invoice, IInvoice } from '../models/Invoice';
import { Subscription } from '../models/Subscription';
import { FinanceTransaction } from '../models/FinanceTransaction';
import { Product } from '../models/Product';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { emitPlatformEvent } from '../lib/eventBus';
import { notifyWorkspaceOwner } from './notification.service';

function generateReceiptNumber(): string {
  return `RCPT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export interface CreateInvoiceInput {
  workspaceId: string;
  contactId: string;
  productId: string;
  subscriptionId?: string;
  amount: number;
  discount?: number;
  tax?: number;
  dueAt: Date;
  installmentNumber?: number;
  installmentsTotal?: number;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<IInvoice> {
  const discount = input.discount ?? 0;
  const tax = input.tax ?? 0;
  const totalAmount = Math.max(input.amount - discount + tax, 0);

  const invoice = await Invoice.create({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    productId: input.productId,
    subscriptionId: input.subscriptionId,
    receiptNumber: generateReceiptNumber(),
    amount: input.amount,
    discount,
    tax,
    totalAmount,
    dueAt: input.dueAt,
    installmentNumber: input.installmentNumber,
    installmentsTotal: input.installmentsTotal,
  });

  await TimelineEvent.create({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    type: 'invoice_created',
    message: `Invoice ${invoice.receiptNumber} created for ₹${totalAmount}.`,
    meta: { invoiceId: String(invoice._id) },
  });

  emitPlatformEvent('finance.invoiceCreated', { workspaceId: input.workspaceId, contactId: input.contactId, invoiceId: String(invoice._id) });
  if (invoice.installmentsTotal) {
    emitPlatformEvent('finance.installmentCreated', { workspaceId: input.workspaceId, contactId: input.contactId, invoiceId: String(invoice._id) });
  }

  return invoice;
}

export async function markInvoicePaid(workspaceId: string, invoiceId: string, paidAmount?: number) {
  const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId });
  if (!invoice) return null;

  const amountPaid = paidAmount ?? invoice.totalAmount;
  invoice.status = 'paid';
  invoice.paidAmount = amountPaid;
  invoice.paidAt = new Date();
  await invoice.save();

  const transaction = await FinanceTransaction.create({
    workspaceId,
    invoiceId: invoice._id,
    contactId: invoice.contactId,
    productId: invoice.productId,
    amount: amountPaid,
    method: 'manual',
    matched: amountPaid === invoice.totalAmount,
  });

  await TimelineEvent.create({
    workspaceId,
    contactId: invoice.contactId,
    type: 'invoice_paid',
    message: `Invoice ${invoice.receiptNumber} paid — ₹${amountPaid}.`,
    meta: { invoiceId: String(invoice._id) },
  });

  const payload = { workspaceId, contactId: String(invoice.contactId), invoiceId: String(invoice._id) };
  emitPlatformEvent(invoice.installmentsTotal ? 'finance.installmentPaid' : 'finance.invoicePaid', payload);
  if (!invoice.subscriptionId && !invoice.installmentsTotal) {
    emitPlatformEvent('finance.oneTimePayment', payload);
  }

  if (invoice.subscriptionId) {
    const subscription = await Subscription.findOne({ _id: invoice.subscriptionId, workspaceId });
    if (subscription) {
      subscription.status = 'active';
      const next = new Date(subscription.nextBillingAt);
      next.setMonth(next.getMonth() + (subscription.billingCycle === 'yearly' ? 12 : 1));
      subscription.nextBillingAt = next;
      await subscription.save();
      emitPlatformEvent('finance.subscriptionPaid', { workspaceId, contactId: String(invoice.contactId), subscriptionId: String(subscription._id) });
    }
  }

  return { invoice, transaction };
}

export async function markInvoiceOverdue(workspaceId: string, invoiceId: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, workspaceId });
  if (!invoice) return null;

  invoice.status = 'overdue';
  await invoice.save();

  const payload = { workspaceId, contactId: String(invoice.contactId), invoiceId: String(invoice._id) };
  emitPlatformEvent(invoice.installmentsTotal ? 'finance.installmentOverdue' : 'finance.invoiceOverdue', payload);
  await notifyWorkspaceOwner(
    workspaceId,
    'finance.invoiceOverdue',
    'Invoice overdue',
    `Invoice ${invoice.receiptNumber} is now overdue`,
    '/finance',
  );

  if (invoice.subscriptionId) {
    const subscription = await Subscription.findOne({ _id: invoice.subscriptionId, workspaceId });
    if (subscription) {
      subscription.status = 'overdue';
      await subscription.save();
      emitPlatformEvent('finance.subscriptionOverdue', { workspaceId, contactId: String(invoice.contactId), subscriptionId: String(subscription._id) });
    }
  }

  return invoice;
}

export interface CreateSubscriptionInput {
  workspaceId: string;
  contactId: string;
  productId: string;
  billingCycle: 'monthly' | 'yearly';
  price: number;
}

export async function createSubscription(input: CreateSubscriptionInput) {
  const nextBillingAt = new Date();
  nextBillingAt.setMonth(nextBillingAt.getMonth() + (input.billingCycle === 'yearly' ? 12 : 1));

  const subscription = await Subscription.create({ ...input, nextBillingAt });

  emitPlatformEvent('finance.subscriptionCreated', {
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    subscriptionId: String(subscription._id),
  });

  return subscription;
}

export async function cancelSubscription(workspaceId: string, subscriptionId: string) {
  const subscription = await Subscription.findOne({ _id: subscriptionId, workspaceId });
  if (!subscription) return null;
  subscription.status = 'cancelled';
  subscription.cancelledAt = new Date();
  await subscription.save();
  emitPlatformEvent('finance.subscriptionCancelled', {
    workspaceId,
    contactId: String(subscription.contactId),
    subscriptionId: String(subscription._id),
  });
  return subscription;
}

export interface RecordTransactionInput {
  workspaceId: string;
  contactId: string;
  productId?: string;
  amount: number;
  method?: 'razorpay' | 'manual' | 'wallet';
  /** For reconciliation testing: force a mismatch even when linked to an invoice. */
  forceMismatch?: boolean;
}

export async function recordOneTimeTransaction(input: RecordTransactionInput) {
  const transaction = await FinanceTransaction.create({
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    productId: input.productId,
    amount: input.amount,
    method: input.method ?? 'manual',
    matched: !input.forceMismatch,
  });

  emitPlatformEvent('finance.oneTimePayment', {
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    transactionId: String(transaction._id),
  });

  return transaction;
}

export async function resolveTransaction(workspaceId: string, transactionId: string) {
  return FinanceTransaction.findOneAndUpdate({ _id: transactionId, workspaceId }, { $set: { resolved: true } }, { new: true });
}

export async function refundTransaction(workspaceId: string, transactionId: string) {
  return FinanceTransaction.findOneAndUpdate({ _id: transactionId, workspaceId }, { $set: { status: 'refunded' } }, { new: true });
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function computeDashboard(workspaceId: string) {
  const workspaceFilter = { workspaceId: new Types.ObjectId(workspaceId) };
  const now = new Date();
  const monthStart = startOfMonth(now);

  const [subscriptions, invoices, transactions, products, contacts] = await Promise.all([
    Subscription.find(workspaceFilter).lean(),
    Invoice.find(workspaceFilter).lean(),
    FinanceTransaction.find(workspaceFilter).lean(),
    Product.find({ workspaceId: workspaceId }).lean(),
    Contact.find({ workspaceId }).select('name email').lean(),
  ]);

  const activeSubs = subscriptions.filter((s) => s.status === 'active');
  const mrr = activeSubs.reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
  const arr = mrr * 12;
  const newThisMonth = subscriptions.filter((s) => s.startedAt >= monthStart).length;
  const cancelledThisMonth = subscriptions.filter((s) => s.cancelledAt && s.cancelledAt >= monthStart);
  const churnRate = activeSubs.length + cancelledThisMonth.length > 0 ? cancelledThisMonth.length / (activeSubs.length + cancelledThisMonth.length) : 0;

  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const gross = invoices.reduce((sum, i) => sum + i.amount, 0);
  const collected = paidInvoices.reduce((sum, i) => sum + i.paidAmount, 0);
  const discounts = invoices.reduce((sum, i) => sum + i.discount, 0);
  const refunds = transactions.filter((t) => t.status === 'refunded').reduce((sum, t) => sum + t.amount, 0);
  const outstanding = invoices.filter((i) => i.status === 'open' || i.status === 'overdue').reduce((sum, i) => sum + (i.totalAmount - i.paidAmount), 0);
  const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
  const collectionRate = gross > 0 ? collected / gross : 0;

  const revenueTrend: { date: string; amount: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dayStr = day.toISOString().slice(0, 10);
    const amount = paidInvoices
      .filter((inv) => inv.paidAt && inv.paidAt.toISOString().slice(0, 10) === dayStr)
      .reduce((sum, inv) => sum + inv.paidAmount, 0);
    revenueTrend.push({ date: dayStr, amount });
  }

  const subscriptionBreakdown = BILLING_CYCLE_KEYS.map((cycle) => ({
    cycle,
    count: activeSubs.filter((s) => s.billingCycle === cycle).length,
  }));

  const mrrNew = subscriptions
    .filter((s) => s.startedAt >= monthStart && s.status !== 'cancelled')
    .reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
  const mrrChurned = cancelledThisMonth.reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);

  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const productPerformance = Object.values(
    paidInvoices.reduce<Record<string, { productId: string; name: string; revenue: number; unitsSold: number }>>((acc, inv) => {
      const key = String(inv.productId);
      const product = productMap.get(key);
      if (!acc[key]) acc[key] = { productId: key, name: product?.name ?? 'Unknown Product', revenue: 0, unitsSold: 0 };
      acc[key].revenue += inv.paidAmount;
      acc[key].unitsSold += 1;
      return acc;
    }, {}),
  ).sort((a, b) => b.revenue - a.revenue);

  const contactMap = new Map(contacts.map((c) => [String(c._id), c]));
  const topCustomers = Object.values(
    paidInvoices.reduce<Record<string, { contactId: string; name: string; revenue: number }>>((acc, inv) => {
      const key = String(inv.contactId);
      const contact = contactMap.get(key);
      if (!acc[key]) acc[key] = { contactId: key, name: contact?.name ?? 'Unknown', revenue: 0 };
      acc[key].revenue += inv.paidAmount;
      return acc;
    }, {}),
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const upcomingRenewals = activeSubs.filter((s) => s.nextBillingAt <= sevenDaysOut && s.nextBillingAt >= now);

  // Every transaction carries a `matched` verdict computed at creation time (invoice-amount
  // comparison for invoice-linked ones, a manual flag for one-time payments) — reconciliation
  // health is meaningful for all of them, not just invoice-linked transactions.
  const reconcilable = transactions;
  const openCount = reconcilable.filter((t) => !t.matched && !t.resolved).length;
  const resolvedCount = reconcilable.filter((t) => t.matched || t.resolved).length;

  const activityFeed = [...invoices]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)
    .map((inv) => ({
      id: String(inv._id),
      message: `Invoice ${inv.receiptNumber} — ${inv.status}`,
      amount: inv.totalAmount,
      at: inv.createdAt,
    }));

  return {
    kpis: { mrr, arr, activeSubscriptions: activeSubs.length, newThisMonth, churnRate },
    revenueSummary: { gross, collected, refunds, outstanding, invoiceCount: invoices.length, collectionRate },
    revenueTrend,
    subscriptionBreakdown,
    overdue: { count: overdueInvoices.length, amount: overdueInvoices.reduce((sum, i) => sum + (i.totalAmount - i.paidAmount), 0), collectionRate, dso: computeDso(paidInvoices) },
    mrrMovement: { new: mrrNew, expansion: 0, churned: mrrChurned },
    revenueWaterfall: { gross, discounts, refunds, net: Math.max(gross - discounts - refunds, 0) },
    productPerformance,
    topCustomers,
    upcomingRenewals: upcomingRenewals.map((s) => ({ subscriptionId: String(s._id), contactId: String(s.contactId), nextBillingAt: s.nextBillingAt, price: s.price })),
    overdueInvoices: overdueInvoices.map((i) => ({ invoiceId: String(i._id), receiptNumber: i.receiptNumber, contactId: String(i.contactId), amount: i.totalAmount - i.paidAmount, dueAt: i.dueAt })),
    activityFeed,
    reconciliation: { open: openCount, resolved: resolvedCount, total: reconcilable.length },
  };
}

const BILLING_CYCLE_KEYS = ['monthly', 'yearly'] as const;

function computeDso(paidInvoices: Pick<IInvoice, 'paidAt' | 'createdAt'>[]): number {
  if (!paidInvoices.length) return 0;
  const totalDays = paidInvoices.reduce((sum, inv) => {
    if (!inv.paidAt) return sum;
    const days = (inv.paidAt.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return sum + Math.max(days, 0);
  }, 0);
  return totalDays / paidInvoices.length;
}
