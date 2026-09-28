import { NavLink, Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Users, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const TABS = [
  { to: '/lead-management/stats', label: 'Overview' },
  { to: '/lead-management/leads', label: 'Leads' },
  { to: '/lead-management/pipeline', label: 'Pipeline' },
  { to: '/lead-management/import', label: 'Import' },
];

export function LeadManagementLayout() {
  const queryClient = useQueryClient();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold">Leads</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Track, import and manage every lead in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NavLink to="/lead-management/import">
            <Button variant="secondary" size="sm">
              <UploadCloud className="h-4 w-4" /> Import Leads
            </Button>
          </NavLink>
          <Button variant="primary" size="sm" onClick={() => queryClient.invalidateQueries()}>
            <RefreshCw className="h-4 w-4" /> Refresh Data
          </Button>
        </div>
      </div>

      <nav
        className="flex w-fit items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
        aria-label="Lead Management sections"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              clsx(
                'rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}
