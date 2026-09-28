import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PublicBookingPage } from './PublicBookingPage';

vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../../lib/apiClient';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/book/abc123']}>
        <Routes>
          <Route path="/book/:publicId" element={<PublicBookingPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const EVENT_TYPE = {
  id: 'et1',
  name: 'Discovery Call',
  description: 'A quick intro call',
  durationMinutes: 30,
  locationType: 'zoom',
  timezone: 'Asia/Kolkata',
  requirePayment: false,
  price: 0,
  currency: 'INR',
  bookingFormFields: [
    { key: 'name', label: 'Full Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
  ],
};

describe('PublicBookingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('/slots')) {
        return Promise.resolve({ data: { slots: [{ startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T10:30:00.000Z' }] } });
      }
      return Promise.resolve({ data: { eventType: EVENT_TYPE } });
    });
  });

  it('shows an unavailable message when the booking page cannot load', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('404'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Booking page not available')).toBeInTheDocument());
  });

  it('lets a visitor pick a slot, fill the form, and confirm a booking', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { appointmentId: 'appt1', status: 'Booked' } });
    renderPage();

    await waitFor(() => expect(screen.getByText('Discovery Call')).toBeInTheDocument());
    const slotButton = await screen.findByRole('button', { name: /\d{1,2}:\d{2}\s?(AM|PM)/i });
    fireEvent.click(slotButton);

    fireEvent.change(await screen.findByLabelText('Full Name *'), { target: { value: 'Jamie Booker' } });
    fireEvent.change(screen.getByLabelText('Email *'), { target: { value: 'jamie@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Booking' }));

    await waitFor(() => expect(screen.getByText("You're booked!")).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith(
      '/public/booking/abc123/book',
      expect.objectContaining({ formResponses: expect.objectContaining({ name: 'Jamie Booker', email: 'jamie@example.com' }) }),
    );
  });
});
