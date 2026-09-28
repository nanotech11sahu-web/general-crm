import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatWidgetWizard } from './ChatWidgetWizard';

vi.mock('../../lib/api/chatWidgets', () => ({
  createChatWidget: vi.fn(),
}));

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatWidgetWizard open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ChatWidgetWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts on step 1 (Branding) and blocks Continue until required fields are filled', async () => {
    renderWizard();
    expect(screen.getByText('Step 1 of 5: Branding')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Still on step 1 — validation should block the transition.
    expect(screen.getByText('Step 1 of 5: Branding')).toBeInTheDocument();
    expect(screen.getByText('Widget name is required.')).toBeInTheDocument();
  });

  it('advances from step 1 (Branding) to step 2 (Theme) once required fields are filled — regression guard for the reference product bug', async () => {
    renderWizard();

    fireEvent.change(screen.getByLabelText('Widget Name'), { target: { value: 'Support Widget' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'PMC Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2 of 5: Theme')).toBeInTheDocument());
    expect(screen.getByText('Position')).toBeInTheDocument();
  });

  it('walks through all 5 steps to Routing and shows Create Widget on the last step', async () => {
    renderWizard();

    fireEvent.change(screen.getByLabelText('Widget Name'), { target: { value: 'Support Widget' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'PMC Demo' } });

    for (const expectedNextStep of ['Step 2 of 5: Theme', 'Step 3 of 5: Pre-Chat', 'Step 4 of 5: Hours', 'Step 5 of 5: Routing']) {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(screen.getByText(expectedNextStep)).toBeInTheDocument());
    }

    expect(screen.getByRole('button', { name: 'Create Widget' })).toBeInTheDocument();
  });

  it('lets the user go back a step without losing later navigation', async () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText('Widget Name'), { target: { value: 'Support Widget' } });
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'PMC Demo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Step 2 of 5: Theme')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText('Step 1 of 5: Branding')).toBeInTheDocument());
  });
});
