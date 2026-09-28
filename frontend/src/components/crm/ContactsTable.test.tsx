import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ContactsTable } from './ContactsTable';

vi.mock('../../lib/api/contacts', () => ({
  listContacts: vi.fn(),
  archiveContact: vi.fn(),
  deleteContact: vi.fn(),
  createContact: vi.fn(),
}));

import { listContacts } from '../../lib/api/contacts';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state when there are no contacts', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({ contacts: [], total: 0, page: 1, limit: 25 });
    renderWithProviders(<ContactsTable />);
    await waitFor(() => expect(screen.getByText('No contacts found')).toBeInTheDocument());
  });

  it('renders a populated table of contacts', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({
      contacts: [
        {
          _id: '1',
          name: 'Demo Lead',
          email: 'demo@example.com',
          temperature: 'Hot',
          lifecycleStage: 'SQL',
          leadScore: 72,
          company: 'Acme',
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    renderWithProviders(<ContactsTable />);
    await waitFor(() => expect(screen.getByText('Demo Lead')).toBeInTheDocument());
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Hot')).toBeInTheDocument();
  });

  it('paginates a large contact list via server-side page/limit, not by fetching everything (Phase 12 load-test DoD)', async () => {
    (listContacts as ReturnType<typeof vi.fn>).mockImplementation(async ({ page = 1 }: { page?: number }) => ({
      contacts: [{ _id: String(page), name: `Contact page ${page}`, email: 'x@example.com', temperature: 'Warm', lifecycleStage: 'Lead', leadScore: 10 }],
      total: 50000,
      page,
      limit: 25,
    }));
    renderWithProviders(<ContactsTable />);

    await waitFor(() => expect(screen.getByText('Contact page 1')).toBeInTheDocument());
    expect(screen.getByText(/50000 contacts/)).toBeInTheDocument();
    expect(screen.getByLabelText('Previous page')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 25 })));
    await waitFor(() => expect(screen.getByText('Contact page 2')).toBeInTheDocument());
  });
});
