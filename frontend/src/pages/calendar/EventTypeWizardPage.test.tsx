import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EventTypeWizardPage } from './EventTypeWizardPage';

vi.mock('../../lib/api/eventTypes', () => ({
  getEventType: vi.fn(),
  updateEventType: vi.fn(),
  publishEventType: vi.fn(),
  deleteEventType: vi.fn(),
}));

import { getEventType, updateEventType, publishEventType } from '../../lib/api/eventTypes';

const BASE_EVENT_TYPE = {
  _id: 'et1',
  name: 'Discovery Call',
  description: '',
  durationMinutes: 30,
  locationType: 'zoom' as const,
  locationDetails: '',
  availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, startTime: '09:00', endTime: '17:00' })),
  timezone: 'Asia/Kolkata',
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeHours: 1,
  dateRangeDays: 30,
  staffMembershipIds: [],
  assignmentMethod: 'round_robin' as const,
  requirePayment: false,
  price: 0,
  currency: 'INR',
  requireApproval: false,
  confirmationMessage: '',
  bookingFormFields: [
    { key: 'name', label: 'Full Name', type: 'text' as const, required: true },
    { key: 'email', label: 'Email', type: 'email' as const, required: true },
  ],
  templateKey: 'scratch',
  templateCategory: 'Custom',
  status: 'draft' as const,
  publicId: 'pub123',
  createdAt: new Date().toISOString(),
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/calendar/event-types/et1']}>
        <Routes>
          <Route path="/calendar/event-types/:id" element={<EventTypeWizardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EventTypeWizardPage (6-step Event Type builder)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getEventType as ReturnType<typeof vi.fn>).mockResolvedValue({ eventType: BASE_EVENT_TYPE, issues: [] });
    (updateEventType as ReturnType<typeof vi.fn>).mockResolvedValue({ eventType: BASE_EVENT_TYPE, issues: [] });
    (publishEventType as ReturnType<typeof vi.fn>).mockResolvedValue({ ...BASE_EVENT_TYPE, status: 'published' });
  });

  it('renders step 1 with the loaded name and lets it be edited', async () => {
    renderPage();
    const input = await screen.findByDisplayValue('Discovery Call');
    fireEvent.change(input, { target: { value: 'Renamed Call' } });
    expect(screen.getByDisplayValue('Renamed Call')).toBeInTheDocument();
  });

  it('saves a draft via Save Draft', async () => {
    renderPage();
    await screen.findByDisplayValue('Discovery Call');
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() => expect(updateEventType).toHaveBeenCalledWith('et1', expect.objectContaining({ name: 'Discovery Call' })));
  });

  it('autosaves when moving to the next step', async () => {
    renderPage();
    await screen.findByDisplayValue('Discovery Call');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));
    await waitFor(() => expect(updateEventType).toHaveBeenCalled());
    expect(await screen.findByText('Buffer before (min)')).toBeInTheDocument();
  });

  it('blocks publish and lists issues on the Review step when the wizard is invalid', async () => {
    (getEventType as ReturnType<typeof vi.fn>).mockResolvedValue({
      eventType: BASE_EVENT_TYPE,
      issues: ['Schedule & Availability — at least one day must be enabled'],
    });
    renderPage();
    await screen.findByDisplayValue('Discovery Call');
    fireEvent.click(screen.getByRole('button', { name: /Review & Publish/ }));

    expect(await screen.findByText('Issues — 1 error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('publishes once the wizard is valid', async () => {
    renderPage();
    await screen.findByDisplayValue('Discovery Call');
    fireEvent.click(screen.getByRole('button', { name: /Review & Publish/ }));

    expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishEventType).toHaveBeenCalledWith('et1'));
  });
});
