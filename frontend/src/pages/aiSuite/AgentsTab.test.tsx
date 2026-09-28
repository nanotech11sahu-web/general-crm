import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AgentsTab } from './AgentsTab';

vi.mock('../../lib/api/aiSuite', () => ({
  listAgents: vi.fn(),
  listAgentTemplates: vi.fn(),
  installAgentTemplate: vi.fn(),
  invokeAgent: vi.fn(),
  listAgentMessages: vi.fn(),
}));

import { listAgents, listAgentTemplates, installAgentTemplate } from '../../lib/api/aiSuite';

const MARKETING_TEMPLATE = {
  key: 'marketing',
  name: 'Marketing Agent',
  description: 'Drafts on-brand marketing copy and keeps leads tagged and segmented — never publishes on its own.',
  tone: 'Friendly, confident, concise',
  systemInstructions: 'You are the Marketing Agent...',
  guardrails: ['Never auto-publish...', 'Never make a false claim...', 'Never reproduce a competitor...'],
  includedSkills: ['Generate Marketing Copy', 'Tag and Segment Lead'],
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AgentsTab — install-in-one-click starter templates (Phase 7 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listAgents as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listAgentTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([MARKETING_TEMPLATE]);
  });

  it('shows the "0 custom agents" empty state and the Marketing Agent template with its full spec', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('0 custom agents')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Templates/ }));
    await waitFor(() => expect(screen.getByText('Marketing Agent')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Generate Marketing Copy')).toBeInTheDocument();
    expect(screen.getByText('Tag and Segment Lead')).toBeInTheDocument();
  });

  it('installs the Marketing Agent template', async () => {
    (installAgentTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 'a1', name: 'Marketing Agent', templateKey: 'marketing', status: 'active' });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: /Templates/ }));
    await waitFor(() => expect(screen.getByText('Marketing Agent')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => expect(installAgentTemplate).toHaveBeenCalledWith('marketing'));
  });
});
