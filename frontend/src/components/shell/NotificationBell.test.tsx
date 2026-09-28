import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NotificationBell } from './NotificationBell';

vi.mock('../../lib/api/notifications', () => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
import { listNotifications } from '../../lib/api/notifications';

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NotificationBell — consolidated cross-module feed (Phase 11 core DoD)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the unread count badge and lists real module notifications when opened', async () => {
    (listNotifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      unreadCount: 2,
      notifications: [
        { _id: 'n1', type: 'finance.invoiceOverdue', title: 'Invoice overdue', message: 'Invoice RCPT-1 is now overdue', read: false, createdAt: new Date().toISOString() },
        { _id: 'n2', type: 'operations.leavePending', title: 'Leave request pending approval', message: 'Jane requested Sick leave', read: false, createdAt: new Date().toISOString() },
      ],
    });
    renderBell();

    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Notifications'));

    await waitFor(() => expect(screen.getByText('Invoice overdue')).toBeInTheDocument());
    expect(screen.getByText('Leave request pending approval')).toBeInTheDocument();
  });
});
