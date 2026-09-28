import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { UrlsPage } from './UrlsPage';

vi.mock('../../lib/api/urls', () => ({
  listDomains: vi.fn(),
  createDomain: vi.fn(),
  listLinks: vi.fn(),
  createLink: vi.fn(),
  getUrlsDashboard: vi.fn(),
}));

import { listDomains, listLinks, getUrlsDashboard } from '../../lib/api/urls';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UrlsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UrlsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getUrlsDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      kpis: { totalLinks: 0, totalClicks: 0, uniqueClicks: 0, domains: 0 },
      popularLinks: [],
    });
  });

  it('shows the no-domain banner and disables Create Link until a domain exists', async () => {
    (listDomains as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listLinks as ReturnType<typeof vi.fn>).mockResolvedValue({ links: [], hasDomain: false });

    renderPage();
    const linksTab = await screen.findByRole('button', { name: 'Links' });
    fireEvent.click(linksTab);

    await waitFor(() => expect(screen.getByText('No domain connected')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Create Link/ })).toBeDisabled();
  });

  it('enables Create Link once a domain exists', async () => {
    (listDomains as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: 'd1', hostname: 'pmc.link', verified: false }]);
    (listLinks as ReturnType<typeof vi.fn>).mockResolvedValue({ links: [], hasDomain: true });

    renderPage();
    const linksTab = await screen.findByRole('button', { name: 'Links' });
    fireEvent.click(linksTab);

    const createButton = await screen.findByRole('button', { name: /Create Link/ });
    expect(screen.queryByText('No domain connected')).not.toBeInTheDocument();
    expect(createButton).not.toBeDisabled();
  });
});
