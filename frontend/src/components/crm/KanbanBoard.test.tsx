import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KanbanBoard } from './KanbanBoard';
import type { Pipeline, Opportunity } from '../../types/crm';

vi.mock('../../lib/api/pipelines', () => ({
  listPipelines: vi.fn(),
  listOpportunities: vi.fn(),
  moveOpportunity: vi.fn(),
}));

import { listPipelines, listOpportunities } from '../../lib/api/pipelines';

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KanbanBoard onAddLead={() => {}} />
    </QueryClientProvider>,
  );
}

const pipeline: Pipeline = {
  _id: 'p1',
  name: 'B2B Sales Pipeline',
  isDefault: true,
  stages: [{ key: 'new_lead', label: 'New Lead', order: 0 }],
};

function makeOpportunities(count: number): Opportunity[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `opp-${i}`,
    contactId: 'c1',
    pipelineId: 'p1',
    stageKey: 'new_lead',
    name: `Deal ${i}`,
    order: i,
    createdAt: new Date().toISOString(),
  }));
}

describe('KanbanBoard — stays usable with 1,000+ cards in one stage (Phase 12 load-test DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue([pipeline]);
  });

  it('renders every card when a stage is small (no virtualization needed)', async () => {
    (listOpportunities as ReturnType<typeof vi.fn>).mockResolvedValue(makeOpportunities(5));
    renderBoard();

    await waitFor(() => expect(screen.getByText('Deal 0')).toBeInTheDocument());
    expect(screen.getByText('Deal 4')).toBeInTheDocument();
  });

  it('windows a 1,000-card stage so far-off cards are not all mounted at once', async () => {
    (listOpportunities as ReturnType<typeof vi.fn>).mockResolvedValue(makeOpportunities(1000));
    renderBoard();

    await waitFor(() => expect(screen.getByText('Deal 0')).toBeInTheDocument());
    // A windowed list only mounts rows near the visible viewport — the 999th card of 1,000
    // must not be in the DOM despite it being in the underlying data set.
    expect(screen.queryByText('Deal 999')).not.toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument(); // the stage's real total-count badge
  });
});
