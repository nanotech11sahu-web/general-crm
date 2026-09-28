import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicFormPage } from './PublicFormPage';

vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../../lib/apiClient';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/f/form123']}>
        <Routes>
          <Route path="/f/:id" element={<PublicFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FORM_RESPONSE = {
  form: {
    id: 'form123',
    name: 'Contact Us',
    fields: [
      { id: 'name', type: 'name', label: 'Name', required: true, options: [] },
      { id: 'email', type: 'email', label: 'Email', required: true, options: [] },
      { id: 'submit', type: 'submit', label: 'Submit', required: false, options: [] },
    ],
    style: { pageBackground: '#fff', cardBackground: '#fff', buttonBackground: '#000', cornerRadius: 8 },
    settings: { gdprConsent: false, onSubmitAction: 'message' },
  },
};

describe('PublicFormPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a not-available message when the form cannot be loaded', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('404'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Form not available')).toBeInTheDocument());
  });

  it('renders published form fields and submits successfully', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: FORM_RESPONSE });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { message: 'Thanks!', onSubmitAction: 'message' } });

    renderPage();
    await waitFor(() => expect(screen.getByText('Contact Us')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'jane@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(screen.getByText('Thanks!')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith(
      '/public/forms/form123/submit',
      expect.objectContaining({ data: expect.objectContaining({ name: 'Jane', email: 'jane@example.com' }) }),
    );
  });
});
