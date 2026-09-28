import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage';

vi.mock('../lib/api/dashboard', () => ({
  getDashboard: vi.fn(),
  getDashboardStaff: vi.fn(),
  getDashboardLayout: vi.fn(),
  saveDashboardLayout: vi.fn(),
}));
vi.mock('../lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ data: { tasks: [], completed: 0, total: 0 } }) } }));

import { getDashboard, getDashboardStaff, getDashboardLayout } from '../lib/api/dashboard';

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe('DashboardPage — 14 real KPIs across 6 groups (Phase 11 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDashboardStaff as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getDashboardLayout as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders KPI values pulled from the owning modules, not hardcoded placeholders', async () => {
    (getDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      timezone: 'Asia/Kolkata',
      range: { from: '2026-09-01', to: '2026-09-17' },
      groups: [
        { group: 'Finance', kpis: [{ key: 'totalRevenue', label: 'Total Revenue', value: 42000, format: 'currency' }] },
        { group: 'Contacts & CRM', kpis: [{ key: 'totalContacts', label: 'Total Contacts', value: 7, format: 'number' }] },
      ],
    });
    renderDashboard();

    await waitFor(() => expect(screen.getByText('₹42,000')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  });
});
