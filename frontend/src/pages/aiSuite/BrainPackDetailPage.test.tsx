import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { BrainPackDetailPage } from './BrainPackDetailPage';

vi.mock('../../lib/api/aiSuite', () => ({
  getBrainPackDetail: vi.fn(),
  chatWithBrain: vi.fn(),
  addBrainKnowledge: vi.fn(),
  resolveUnansweredQuestion: vi.fn(),
}));

import { getBrainPackDetail, chatWithBrain } from '../../lib/api/aiSuite';

const DETAIL = {
  pack: { key: 'finance', name: 'Finance', hasLiveData: true },
  docs: [{ _id: 'd1', packKey: 'finance', type: 'seeded' as const, title: 'Finance overview', content: 'Current MRR is ₹5,000.', createdAt: new Date().toISOString() }],
  unanswered: [],
  dailyTrainingQuestion: 'What is our current MRR?',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ai-suite/brain/finance']}>
        <Routes>
          <Route path="/ai-suite/brain/:key" element={<BrainPackDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BrainPackDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getBrainPackDetail as ReturnType<typeof vi.fn>).mockResolvedValue(DETAIL);
  });

  it('renders the seeded doc and answers a grounded question via Chat with Brain', async () => {
    (chatWithBrain as ReturnType<typeof vi.fn>).mockResolvedValue({ answer: 'Based on what\'s on file: Current MRR is ₹5,000.', grounded: true });
    renderPage();

    await waitFor(() => expect(screen.getByText('Finance overview')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Ask the brain a question'), { target: { value: 'What is our current MRR?' } });
    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));

    await waitFor(() => expect(screen.getByText(/Current MRR is/)).toBeInTheDocument());
    expect(screen.getByText('Grounded')).toBeInTheDocument();
    expect(chatWithBrain).toHaveBeenCalledWith('finance', 'What is our current MRR?');
  });
});
