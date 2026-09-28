export const INVOICE_STATUSES = ['open', 'paid', 'overdue', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceDoc {
  _id: string;
  contactId: string;
  productId: string;
  subscriptionId?: string;
  receiptNumber: string;
  amount: number;
  discount: number;
  tax: number;
  totalAmount: number;
  paidAmount: number;
  status: InvoiceStatus;
  dueAt: string;
  paidAt?: string;
  installmentNumber?: number;
  installmentsTotal?: number;
  createdAt: string;
}

export const SUBSCRIPTION_STATUSES = ['active', 'overdue', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface SubscriptionDoc {
  _id: string;
  contactId: string;
  productId: string;
  billingCycle: 'monthly' | 'yearly';
  price: number;
  status: SubscriptionStatus;
  startedAt: string;
  nextBillingAt: string;
  cancelledAt?: string;
}

export interface FinanceTransactionDoc {
  _id: string;
  invoiceId?: string;
  contactId: string;
  productId?: string;
  amount: number;
  method: 'razorpay' | 'manual' | 'wallet';
  status: 'success' | 'refunded';
  matched: boolean;
  resolved: boolean;
  createdAt: string;
}

export interface FinanceProductDoc {
  _id: string;
  name: string;
  salePrice: number;
  currency: string;
  source: string;
}

export interface TaxProfileDoc {
  _id: string;
  name: string;
  ratePercent: number;
  isDefault: boolean;
}

export interface FinanceDashboard {
  kpis: { mrr: number; arr: number; activeSubscriptions: number; newThisMonth: number; churnRate: number };
  revenueSummary: { gross: number; collected: number; refunds: number; outstanding: number; invoiceCount: number; collectionRate: number };
  revenueTrend: { date: string; amount: number }[];
  subscriptionBreakdown: { cycle: string; count: number }[];
  overdue: { count: number; amount: number; collectionRate: number; dso: number };
  mrrMovement: { new: number; expansion: number; churned: number };
  revenueWaterfall: { gross: number; discounts: number; refunds: number; net: number };
  productPerformance: { productId: string; name: string; revenue: number; unitsSold: number }[];
  topCustomers: { contactId: string; name: string; revenue: number }[];
  upcomingRenewals: { subscriptionId: string; contactId: string; nextBillingAt: string; price: number }[];
  overdueInvoices: { invoiceId: string; receiptNumber: string; contactId: string; amount: number; dueAt: string }[];
  activityFeed: { id: string; message: string; amount: number; at: string }[];
  reconciliation: { open: number; resolved: number; total: number };
}
