import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DomainsTab } from './DomainsTab';

vi.mock('../../lib/api/settings', () => ({
  listDomains: vi.fn(),
  addDomain: vi.fn(),
  verifyDomain: vi.fn(),
  listFeatureAssignments: vi.fn(),
  assignFeatureDomain: vi.fn(),
}));
vi.mock('../../lib/api/funnels', () => ({ listFunnels: vi.fn() }));
vi.mock('../../lib/api/forms', () => ({ listForms: vi.fn() }));

import { listDomains, listFeatureAssignments } from '../../lib/api/settings';
import { listFunnels } from '../../lib/api/funnels';
import { listForms } from '../../lib/api/forms';

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DomainsTab />
    </QueryClientProvider>,
  );
}

describe('DomainsTab — verified domain selectable for Funnels/Forms (Phase 10 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listFunnels as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: 'f1', name: 'Landing Page' }]);
    (listForms as ReturnType<typeof vi.fn>).mockResolvedValue([{ _id: 'form1', name: 'Signup' }]);
    (listFeatureAssignments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('shows an unverified domain without a select-to-apply option, and a verified one with it', async () => {
    (listDomains as ReturnType<typeof vi.fn>).mockResolvedValue([
      { _id: 'd1', hostname: 'unverified.example.com', verified: false },
      { _id: 'd2', hostname: 'verified.example.com', verified: true },
    ]);
    renderTab();

    await waitFor(() => expect(screen.getByText('unverified.example.com')).toBeInTheDocument());
    expect(screen.getAllByText('verified.example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Verified')).toBeInTheDocument();

    const funnelSelect = screen.getByLabelText('Funnel and domain');
    expect(funnelSelect.textContent).toContain('verified.example.com → Landing Page');
    expect(funnelSelect.textContent).not.toContain('unverified.example.com');
  });
});
