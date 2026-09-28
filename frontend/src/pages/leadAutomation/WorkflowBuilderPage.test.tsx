import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WorkflowBuilderPage } from './WorkflowBuilderPage';

vi.mock('../../lib/api/workflows', () => ({
  getWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  publishWorkflow: vi.fn(),
  unpublishWorkflow: vi.fn(),
  runWorkflowOnce: vi.fn(),
  listWorkflowRuns: vi.fn(),
  listTriggers: vi.fn(),
}));
vi.mock('../../lib/api/contacts', async () => {
  const actual = await vi.importActual('../../lib/api/contacts');
  return { ...actual, listContacts: vi.fn() };
});

import { getWorkflow, updateWorkflow, listTriggers } from '../../lib/api/workflows';
import { listContacts } from '../../lib/api/contacts';

const WORKFLOW_RESPONSE = {
  workflow: {
    _id: 'wf1',
    name: 'Welcome Flow',
    status: 'draft',
    triggerKey: 'contact.created',
    version: 1,
    nodes: [{ id: 'trigger-1', kind: 'trigger', position: { x: 50, y: 150 }, data: { triggerKey: 'contact.created' } }],
    edges: [],
    createdAt: new Date().toISOString(),
  },
  issues: ['Workflow has no actions — add at least one action node'],
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/lead-automation/workflows/wf1']}>
        <Routes>
          <Route path="/lead-automation/workflows/:id" element={<WorkflowBuilderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkflowBuilderPage (drag/drop canvas)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue(WORKFLOW_RESPONSE);
    (listTriggers as ReturnType<typeof vi.fn>).mockResolvedValue([{ key: 'contact.created', label: 'Contact Created', category: 'Contact Events', wired: true }]);
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({ contacts: [{ _id: 'c1', name: 'Demo Lead' }], total: 1, page: 1, limit: 25 });
    (updateWorkflow as ReturnType<typeof vi.fn>).mockResolvedValue({ workflow: WORKFLOW_RESPONSE.workflow, issues: [] });
  });

  it('renders the trigger node and shows the lint issue count', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Welcome Flow')).toBeInTheDocument());
    expect(screen.getByText('Issues — 1 error')).toBeInTheDocument();
    expect(screen.getByText('Contact Created')).toBeInTheDocument();
  });

  it('adds an action node from the palette onto the canvas', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Welcome Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add Tag/ }));
    expect(await screen.findByText('No tag set')).toBeInTheDocument();
    expect(screen.getAllByText('Add Tag')).toHaveLength(2); // palette button + node title
  });

  it('configures an action node and reflects the saved value on the node', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Welcome Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add Tag/ }));
    await screen.findByText('No tag set');

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    const input = await screen.findByLabelText('Tag name');
    fireEvent.change(input, { target: { value: 'Hot Lead' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Tag: Hot Lead')).toBeInTheDocument());
  });

  it('removes a node when its delete control is used', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Welcome Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add Tag/ }));
    await screen.findByText('No tag set');
    fireEvent.click(screen.getByRole('button', { name: 'Delete node' }));

    await waitFor(() => expect(screen.queryByText('No tag set')).not.toBeInTheDocument());
  });

  it('saves the current canvas nodes/edges via the Save button', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Welcome Flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalled());
  });
});
