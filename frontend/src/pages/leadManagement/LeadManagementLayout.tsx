import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { Users, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';

const TABS = [
  { to: '/lead-management/stats', label: 'Overview' },
  { to: '/lead-management/leads', label: 'Leads' },
  { to: '/lead-management/pipeline', label: 'Pipeline' },
];

export function LeadManagementLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between animate-fade-in-up">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[image:var(--gradient-primary)] text-white shadow-sm">
            <Users className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Track and manage every lead in one place.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => queryClient.invalidateQueries()}>
            <RefreshCw className="h-4 w-4" /> Refresh Data
          </Button>
        </div>
      </div>

      <nav
        className="relative flex w-fit items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]"
        aria-label="Lead Management sections"
      >
        {TABS.map((tab) => {
          const isActive = location.pathname.startsWith(tab.to);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={clsx(
                'relative z-10 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors duration-200',
                isActive ? 'text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="lead-tab-indicator"
                  className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[image:var(--gradient-primary)] shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              {tab.label}
            </NavLink>
          );
        })}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <Outlet />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
