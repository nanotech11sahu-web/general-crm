import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { BulkCampaignsPage } from './BulkCampaignsPage';

vi.mock('../../lib/api/bulkCampaigns', () => ({
  listBulkCampaigns: vi.fn(),
  createBulkCampaign: vi.fn(),
  sendBulkCampaign: vi.fn(),
}));

import { listBulkCampaigns } from '../../lib/api/bulkCampaigns';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BulkCampaignsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BulkCampaignsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the empty state when there are no campaigns', async () => {
    (listBulkCampaigns as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('No campaigns found')).toBeInTheDocument());
  });

  it('renders campaigns with channel and status info', async () => {
    (listBulkCampaigns as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: '1', name: 'Diwali Sale', channels: ['email', 'whatsapp'], status: 'draft', recipientCount: 42, sentCount: 0, createdAt: new Date().toISOString() },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('Diwali Sale')).toBeInTheDocument());
    expect(screen.getByText('email + whatsapp · 42 recipients')).toBeInTheDocument();
  });
});
