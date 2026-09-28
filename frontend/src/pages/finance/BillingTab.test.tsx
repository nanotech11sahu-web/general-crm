import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BillingTab } from './BillingTab';

vi.mock('../../lib/api/finance', () => ({
  listInvoices: vi.fn(),
  createInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
  markInvoiceOverdue: vi.fn(),
  cancelInvoice: vi.fn(),
  listSubscriptions: vi.fn(),
  createSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  listTransactions: vi.fn(),
  createTransaction: vi.fn(),
  resolveTransaction: vi.fn(),
  refundTransaction: vi.fn(),
  listFinanceProducts: vi.fn(),
}));
vi.mock('../../lib/api/contacts', async () => {
  const actual = await vi.importActual('../../lib/api/contacts');
  return { ...actual, listContacts: vi.fn() };
});

import { listInvoices, listTransactions, listFinanceProducts, resolveTransaction } from '../../lib/api/finance';
import { listContacts } from '../../lib/api/contacts';

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BillingTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BillingTab — Reconciliation (Phase 6 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listInvoices as ReturnType<typeof vi.fn>).mockResolvedValue({ invoices: [], total: 0, page: 1, limit: 20 });
    (listFinanceProducts as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: 'p1', name: 'Pro Plan', salePrice: 999, currency: 'INR', source: 'ecom' }]);
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({ contacts: [{ _id: 'c1', name: 'Jamie Booker' }], total: 1, page: 1, limit: 100 });
  });

  it('flags an intentionally-mismatched transaction as Open and lets it be resolved', async () => {
    (listTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: 't1', contactId: 'c1', amount: 750, method: 'manual', status: 'success', matched: false, resolved: false, createdAt: new Date().toISOString() },
    ]);
    (resolveTransaction as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 't1', resolved: true, matched: false, status: 'success' });

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    await waitFor(() => expect(screen.getByText('Open')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(resolveTransaction).toHaveBeenCalledWith('t1'));
  });

  it('shows a matched transaction as Resolved with no action needed', async () => {
    (listTransactions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: 't2', contactId: 'c1', amount: 1000, method: 'manual', status: 'success', matched: true, resolved: false, createdAt: new Date().toISOString() },
    ]);

    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Transactions' }));

    await waitFor(() => expect(screen.getByText('Resolved')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  });
});
