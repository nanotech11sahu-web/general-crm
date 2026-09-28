import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Receipt, RefreshCw, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  listInvoices,
  createInvoice,
  markInvoicePaid,
  markInvoiceOverdue,
  cancelInvoice,
  listSubscriptions,
  createSubscription,
  cancelSubscription,
  listTransactions,
  createTransaction,
  resolveTransaction,
  refundTransaction,
  listFinanceProducts,
} from '../../lib/api/finance';
import { listContacts } from '../../lib/api/contacts';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { InvoiceDoc, SubscriptionDoc } from '../../types/finance';

const SUB_TABS = ['Subscriptions', 'Invoices', 'Transactions'] as const;
type SubTab = (typeof SUB_TABS)[number];

function currency(n: number): string {
  return `₹${Math.round(n).toLocaleString()}`;
}

export function BillingTab() {
  const [subTab, setSubTab] = useState<SubTab>('Invoices');
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {SUB_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSubTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium',
              subTab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {subTab === 'Subscriptions' && <SubscriptionsSubTab />}
      {subTab === 'Invoices' && <InvoicesSubTab />}
      {subTab === 'Transactions' && <TransactionsSubTab />}
    </div>
  );
}

function useNameMaps() {
  const { data: contactsData } = useQuery({ queryKey: ['finance-contacts'], queryFn: () => listContacts({ limit: 100 }) });
  const { data: products } = useQuery({ queryKey: ['finance-products'], queryFn: listFinanceProducts });
  const contactMap = useMemo(() => new Map((contactsData?.contacts ?? []).map((c) => [c._id, c.name])), [contactsData]);
  const productMap = useMemo(() => new Map((products ?? []).map((p) => [p._id, p.name])), [products]);
  return { contacts: contactsData?.contacts ?? [], products: products ?? [], contactMap, productMap };
}

function InvoicesSubTab() {
  const queryClient = useQueryClient();
  const [dueSoonOnly, setDueSoonOnly] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { contactMap, productMap } = useNameMaps();

  const dueBefore = dueSoonOnly ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined;
  const { data, isLoading } = useQuery({ queryKey: ['finance-invoices', dueSoonOnly], queryFn: () => listInvoices({ dueBefore }) });

  const kpis = useMemo(() => {
    const invoices = data?.invoices ?? [];
    return {
      total: invoices.length,
      active: invoices.filter((i) => i.status === 'open').length,
      overdue: invoices.filter((i) => i.status === 'overdue').length,
      cancelled: invoices.filter((i) => i.status === 'cancelled').length,
    };
  }, [data]);

  const markPaidMutation = useMutation({
    mutationFn: (id: string) => markInvoicePaid(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['finance-subscriptions'] });
      toast('Invoice marked paid', { variant: 'success' });
    },
  });

  const markOverdueMutation = useMutation({
    mutationFn: (id: string) => markInvoiceOverdue(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Invoice marked overdue', { variant: 'success' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      toast('Invoice cancelled', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="text-xs text-[var(--color-text-muted)]">Total</p>
          <p className="text-lg font-semibold">{kpis.total}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-text-muted)]">Active</p>
          <p className="text-lg font-semibold">{kpis.active}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-text-muted)]">Overdue</p>
          <p className="text-lg font-semibold">{kpis.overdue}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-[var(--color-text-muted)]">Cancelled</p>
          <p className="text-lg font-semibold">{kpis.cancelled}</p>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
          <button
            type="button"
            onClick={() => setDueSoonOnly(false)}
            className={clsx('rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-sm font-medium', !dueSoonOnly ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]')}
          >
            All time
          </button>
          <button
            type="button"
            onClick={() => setDueSoonOnly(true)}
            className={clsx('rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-sm font-medium', dueSoonOnly ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]')}
          >
            Due Soon
          </button>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Invoice
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : !data?.invoices.length ? (
        <EmptyState icon={Receipt} title="No invoices yet" actionLabel="Create Invoice" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--color-text-muted)]">
                <th className="pb-2">ID</th>
                <th className="pb-2">Status · Created</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Product</th>
                <th className="pb-2">Price</th>
                <th className="pb-2">Paid</th>
                <th className="pb-2">Pending</th>
                <th className="pb-2">Discount</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <InvoiceRow
                  key={inv._id}
                  invoice={inv}
                  customerName={contactMap.get(inv.contactId) ?? '—'}
                  productName={productMap.get(inv.productId) ?? '—'}
                  onMarkPaid={() => markPaidMutation.mutate(inv._id)}
                  onMarkOverdue={() => markOverdueMutation.mutate(inv._id)}
                  onCancel={() => cancelMutation.mutate(inv._id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateInvoiceModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

const INVOICE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  open: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
};

function InvoiceRow({
  invoice,
  customerName,
  productName,
  onMarkPaid,
  onMarkOverdue,
  onCancel,
}: {
  invoice: InvoiceDoc;
  customerName: string;
  productName: string;
  onMarkPaid: () => void;
  onMarkOverdue: () => void;
  onCancel: () => void;
}) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-2 font-mono text-xs">{invoice.receiptNumber}</td>
      <td className="py-2">
        <Badge tone={INVOICE_STATUS_TONE[invoice.status]}>{invoice.status}</Badge>
        <p className="text-xs text-[var(--color-text-muted)]">{new Date(invoice.createdAt).toLocaleDateString()}</p>
      </td>
      <td className="py-2">{customerName}</td>
      <td className="py-2">{productName}</td>
      <td className="py-2">{currency(invoice.totalAmount)}</td>
      <td className="py-2">{currency(invoice.paidAmount)}</td>
      <td className="py-2">{currency(invoice.totalAmount - invoice.paidAmount)}</td>
      <td className="py-2">{currency(invoice.discount)}</td>
      <td className="py-2">
        <div className="flex gap-1">
          {invoice.status === 'open' && (
            <>
              <Button size="sm" variant="secondary" onClick={onMarkPaid}>
                Mark Paid
              </Button>
              <Button size="sm" variant="ghost" onClick={onMarkOverdue}>
                Mark Overdue
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
          {invoice.status === 'overdue' && (
            <Button size="sm" variant="secondary" onClick={onMarkPaid}>
              Mark Paid
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function CreateInvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { contacts, products } = useNameMaps();
  const [contactId, setContactId] = useState('');
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [dueAt, setDueAt] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createInvoice({ contactId, productId, amount, discount, dueAt: new Date(dueAt).toISOString() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Invoice created', { variant: 'success' });
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create Invoice">
      <div className="space-y-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Customer</span>
          <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">Select a customer…</option>
            {contacts.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Product</span>
          <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select a product…</option>
            {products.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount" type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <Input label="Discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </div>
        <Input label="Due Date" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        <Button disabled={!contactId || !productId || !dueAt || !amount} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Create
        </Button>
      </div>
    </Modal>
  );
}

function SubscriptionsSubTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { contacts, products, contactMap, productMap } = useNameMaps();
  const { data: subscriptions, isLoading } = useQuery({ queryKey: ['finance-subscriptions'], queryFn: () => listSubscriptions() });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelSubscription(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Subscription cancelled', { variant: 'success' });
    },
  });

  const [contactId, setContactId] = useState('');
  const [productId, setProductId] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [price, setPrice] = useState(0);

  const createMutation = useMutation({
    mutationFn: () => createSubscription({ contactId, productId, billingCycle, price }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Subscription created', { variant: 'success' });
      setCreateOpen(false);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Subscription
        </Button>
      </div>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !subscriptions?.length ? (
        <EmptyState icon={RefreshCw} title="No subscriptions yet" actionLabel="Create Subscription" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-2">
          {subscriptions.map((s: SubscriptionDoc) => (
            <Card key={s._id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {contactMap.get(s.contactId) ?? 'Unknown'} — {productMap.get(s.productId) ?? 'Unknown'}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {currency(s.price)} / {s.billingCycle} · Next: {new Date(s.nextBillingAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={s.status === 'active' ? 'success' : s.status === 'overdue' ? 'danger' : 'neutral'}>{s.status}</Badge>
                {s.status !== 'cancelled' && (
                  <Button size="sm" variant="ghost" onClick={() => cancelMutation.mutate(s._id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Subscription">
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Customer</span>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Select a customer…</option>
              {contacts.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Product</span>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Billing Cycle</span>
              <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as 'monthly' | 'yearly')}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <Input label="Price" type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
          </div>
          <Button disabled={!contactId || !productId || !price} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Create
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function TransactionsSubTab() {
  const queryClient = useQueryClient();
  const { contacts, contactMap } = useNameMaps();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: transactions, isLoading } = useQuery({ queryKey: ['finance-transactions'], queryFn: () => listTransactions() });

  const [contactId, setContactId] = useState('');
  const [amount, setAmount] = useState(0);
  const [forceMismatch, setForceMismatch] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createTransaction({ contactId, amount, method: 'manual', forceMismatch }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Transaction recorded', { variant: 'success' });
      setCreateOpen(false);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Transaction resolved', { variant: 'success' });
    },
  });

  const refundMutation = useMutation({
    mutationFn: (id: string) => refundTransaction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-dashboard'] });
      toast('Transaction refunded', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Record Transaction
        </Button>
      </div>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !transactions?.length ? (
        <EmptyState icon={Receipt} title="No transactions yet" />
      ) : (
        <div className="space-y-2">
          {transactions.map((t) => (
            <Card key={t._id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {contactMap.get(t.contactId) ?? 'Unknown'} — {currency(t.amount)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t.method} · {new Date(t.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {t.status === 'refunded' ? (
                  <Badge tone="danger">Refunded</Badge>
                ) : !t.matched && !t.resolved ? (
                  <Badge tone="warning" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> Open
                  </Badge>
                ) : (
                  <Badge tone="success" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Resolved
                  </Badge>
                )}
                {!t.matched && !t.resolved && (
                  <Button size="sm" variant="secondary" onClick={() => resolveMutation.mutate(t._id)}>
                    Resolve
                  </Button>
                )}
                {t.status === 'success' && (
                  <Button size="sm" variant="ghost" className="gap-1" onClick={() => refundMutation.mutate(t._id)}>
                    <XCircle className="h-3.5 w-3.5" /> Refund
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Record Transaction">
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Customer</span>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">Select a customer…</option>
              {contacts.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Input label="Amount" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={forceMismatch} onChange={(e) => setForceMismatch(e.target.checked)} />
            Simulate a reconciliation mismatch (for testing the Reconciliation view)
          </label>
          <Button disabled={!contactId || !amount} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Record
          </Button>
        </div>
      </Modal>
    </div>
  );
}
