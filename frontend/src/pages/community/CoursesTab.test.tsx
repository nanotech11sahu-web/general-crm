import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CoursesTab } from './CoursesTab';

vi.mock('../../lib/api/community', () => ({
  listCourses: vi.fn(),
  createCourse: vi.fn(),
  purchaseCourse: vi.fn(),
}));
vi.mock('../../lib/api/contacts', () => ({ listContacts: vi.fn() }));

import { listCourses, purchaseCourse } from '../../lib/api/community';
import { listContacts } from '../../lib/api/contacts';

const COURSE = { _id: 'course1', name: 'Advanced Marketing', description: 'Learn advanced marketing', status: 'published' as const, createdAt: new Date().toISOString() };

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoursesTab />
    </QueryClientProvider>,
  );
}

describe('CoursesTab — Course purchase grants access (Phase 9 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listCourses as ReturnType<typeof vi.fn>).mockResolvedValue([COURSE]);
    (listContacts as ReturnType<typeof vi.fn>).mockResolvedValue({ contacts: [{ _id: 'contact1', name: 'Jamie Booker' }], total: 1, page: 1, limit: 20 });
    (purchaseCourse as ReturnType<typeof vi.fn>).mockResolvedValue({ _id: 'e1', courseId: 'course1', contactId: 'contact1', status: 'active', enrolledAt: new Date().toISOString() });
  });

  it('enrolls a contact in a published course', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Advanced Marketing')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Enroll a contact in Advanced Marketing'), { target: { value: 'contact1' } });

    await waitFor(() => expect(purchaseCourse).toHaveBeenCalledWith('course1', 'contact1'));
  });
});
