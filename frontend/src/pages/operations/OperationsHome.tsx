import { useState } from 'react';
import clsx from 'clsx';
import { ProjectsTab } from './ProjectsTab';
import { SchoolTab } from './SchoolTab';

const TABS = ['Projects', 'Education'] as const;
type Tab = (typeof TABS)[number];

export function OperationsHome() {
  const [tab, setTab] = useState<Tab>('Projects');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Operations & Inventory</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Operations tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Projects' && <ProjectsTab />}
      {tab === 'Education' && <SchoolTab />}
    </div>
  );
}
