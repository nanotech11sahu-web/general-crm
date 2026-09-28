import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SchoolTab } from './SchoolTab';

vi.mock('../../lib/api/school', () => ({
  getSchoolDashboard: vi.fn(),
  getSetupProgress: vi.fn(),
  listAcademicYears: vi.fn(),
  createAcademicYear: vi.fn(),
  listClasses: vi.fn(),
  createClass: vi.fn(),
  listSubjects: vi.fn(),
  createSubject: vi.fn(),
  listStudents: vi.fn(),
  createStudent: vi.fn(),
  getPortalAccess: vi.fn(),
}));
vi.mock('../../lib/api/hrm', () => ({ listStaff: vi.fn() }));

import { getSchoolDashboard, getSetupProgress } from '../../lib/api/school';
import { listStaff } from '../../lib/api/hrm';

const PROGRESS = {
  fullFunctionality: false,
  items: [
    { key: 'academicYear', label: 'Academic Year', required: true, complete: false, count: 0 },
    { key: 'classesAndSections', label: 'Classes & Sections', required: true, complete: true, count: 1 },
    { key: 'subjects', label: 'Subjects', required: true, complete: false, count: 0 },
    { key: 'teachers', label: 'Teachers', required: true, complete: false, count: 0 },
    { key: 'students', label: 'Students', required: true, complete: false, count: 0 },
  ],
};

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SchoolTab />
    </QueryClientProvider>,
  );
}

describe('SchoolTab — Setup Progress checklist (Phase 8 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getSchoolDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ kpis: { students: 0, teachers: 0, classes: 1, attendancePercent: 0, eventsToday: 0 } });
    (getSetupProgress as ReturnType<typeof vi.fn>).mockResolvedValue(PROGRESS);
    (listStaff as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('shows incomplete required items and gates "full functionality"', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Setup incomplete')).toBeInTheDocument());
    expect(screen.getByText('Academic Year')).toBeInTheDocument();
    expect(screen.getByText('Classes & Sections')).toBeInTheDocument();
  });
});
