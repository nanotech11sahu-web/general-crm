import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';

vi.mock('../../lib/api/settings', () => ({ getBranding: vi.fn() }));
import { getBranding } from '../../lib/api/settings';

function renderSidebar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar — white-label branding reflected live (Phase 10 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the workspace experience name and applies the custom primary color once branding loads', async () => {
    (getBranding as ReturnType<typeof vi.fn>).mockResolvedValue({ experienceName: 'Acme Workspace', primaryColor: '#16a34a', mobileNavLocked: false });
    renderSidebar();

    await waitFor(() => expect(screen.getByText('Acme Workspace')).toBeInTheDocument());
    const aside = screen.getByLabelText('Primary navigation');
    expect(aside.style.getPropertyValue('--color-primary')).toBe('#16a34a');
  });
});
