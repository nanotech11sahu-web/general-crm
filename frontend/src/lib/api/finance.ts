import { api } from '../apiClient';
import type { FinanceDashboard, InvoiceDoc, SubscriptionDoc, FinanceTransactionDoc, FinanceProductDoc, TaxProfileDoc } from '../../types/finance';

export async function getDashboard() {
  const res = await api.get('/finance/dashboard');
  return res.data as FinanceDashboard;
}

export async function listFinanceProducts() {
  const res = await api.get('/finance/products');
  return res.data.products as FinanceProductDoc[];
}

export async function listTaxProfiles() {
  const res = await api.get('/finance/tax-profiles');
  return res.data.profiles as TaxProfileDoc[];
}

export async function createTaxProfile(payload: { name: string; ratePercent: number; isDefault?: boolean }) {
  const res = await api.post('/finance/tax-profiles', payload);
  return res.data.profile as TaxProfileDoc;
}

export async function getRazorpayStatus() {
  const res = await api.get('/finance/razorpay-status');
  return res.data as { connected: boolean; accountEmail?: string };
}

export async function connectRazorpay() {
  const res = await api.post('/finance/razorpay-connect');
  return res.data as { connected: boolean; accountEmail?: string };
}

export async function listInvoices(params?: { status?: string; page?: number; limit?: number; dueBefore?: string; contactId?: string }) {
  const res = await api.get('/finance/invoices', { params });
  return res.data as { invoices: InvoiceDoc[]; total: number; page: number; limit: number };
}

export async function createInvoice(payload: {
  contactId: string;
  productId: string;
  subscriptionId?: string;
  amount: number;
  discount?: number;
  tax?: number;
  dueAt: string;
  installmentNumber?: number;
  installmentsTotal?: number;
}) {
  const res = await api.post('/finance/invoices', payload);
  return res.data.invoice as InvoiceDoc;
}

export async function markInvoicePaid(id: string, paidAmount?: number) {
  const res = await api.post(`/finance/invoices/${id}/mark-paid`, { paidAmount });
  return res.data as { invoice: InvoiceDoc; transaction: FinanceTransactionDoc };
}

export async function markInvoiceOverdue(id: string) {
  const res = await api.post(`/finance/invoices/${id}/mark-overdue`);
  return res.data.invoice as InvoiceDoc;
}

export async function cancelInvoice(id: string) {
  const res = await api.post(`/finance/invoices/${id}/cancel`);
  return res.data.invoice as InvoiceDoc;
}

export async function listSubscriptions(params?: { contactId?: string }) {
  const res = await api.get('/finance/subscriptions', { params });
  return res.data.subscriptions as SubscriptionDoc[];
}

export async function createSubscription(payload: { contactId: string; productId: string; billingCycle: 'monthly' | 'yearly'; price: number }) {
  const res = await api.post('/finance/subscriptions', payload);
  return res.data.subscription as SubscriptionDoc;
}

export async function cancelSubscription(id: string) {
  const res = await api.post(`/finance/subscriptions/${id}/cancel`);
  return res.data.subscription as SubscriptionDoc;
}

export async function listTransactions(unresolvedOnly?: boolean) {
  const res = await api.get('/finance/transactions', { params: unresolvedOnly ? { unresolved: 'true' } : undefined });
  return res.data.transactions as FinanceTransactionDoc[];
}

export async function createTransaction(payload: { contactId: string; productId?: string; amount: number; method?: 'razorpay' | 'manual' | 'wallet'; forceMismatch?: boolean }) {
  const res = await api.post('/finance/transactions', payload);
  return res.data.transaction as FinanceTransactionDoc;
}

export async function resolveTransaction(id: string) {
  const res = await api.post(`/finance/transactions/${id}/resolve`);
  return res.data.transaction as FinanceTransactionDoc;
}

export async function refundTransaction(id: string) {
  const res = await api.post(`/finance/transactions/${id}/refund`);
  return res.data.transaction as FinanceTransactionDoc;
}
