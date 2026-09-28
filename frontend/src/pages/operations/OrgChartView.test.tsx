import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgChartView } from './OrgChartView';

vi.mock('../../lib/api/hrm', () => ({ getOrgChart: vi.fn() }));
import { getOrgChart } from '../../lib/api/hrm';

const CHART = {
  kpis: { totalStaff: 2, humanCount: 2, aiAgentCount: 1, departmentCount: 1, teamCount: 1, depth: 3 },
  tree: {
    id: 'owner',
    name: 'Owner',
    kind: 'owner' as const,
    children: [
      { id: 's1', name: 'Casey CEO', kind: 'staff' as const, children: [{ id: 's2', name: 'Riley Report', kind: 'staff' as const, children: [] }] },
    ],
  },
};

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgChartView />
    </QueryClientProvider>,
  );
}

describe('OrgChartView — HRM Org Chart (Phase 8 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getOrgChart as ReturnType<typeof vi.fn>).mockResolvedValue(CHART);
  });

  it('renders the KPI tiles and a real tree from Staff data', async () => {
    renderView();
    await waitFor(() => expect(screen.getByText('Owner')).toBeInTheDocument());
    expect(screen.getByText('Casey CEO')).toBeInTheDocument();
    expect(screen.getByText('Riley Report')).toBeInTheDocument();
    expect(screen.getByText('AI Agents').nextElementSibling?.textContent).toBe('1');
  });
});
