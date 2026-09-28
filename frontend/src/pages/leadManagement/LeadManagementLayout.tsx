import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';

const TABS = [
  { to: '/lead-management/stats', label: 'Stats' },
  { to: '/lead-management/leads', label: 'Leads' },
  { to: '/lead-management/pipeline', label: 'Pipeline' },
];

export function LeadManagementLayout() {
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 border-b border-[var(--color-border)]" aria-label="Lead Management sections">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              clsx(
                'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
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
