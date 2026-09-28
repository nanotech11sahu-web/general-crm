import { useState } from 'react';
import clsx from 'clsx';
import { DashboardTab } from './DashboardTab';
import { BrainTab } from './BrainTab';
import { AgentsTab } from './AgentsTab';
import { MoreTab } from './MoreTab';

const TABS = ['Dashboard', 'AI Brain', 'AI Agents', 'More'] as const;
type Tab = (typeof TABS)[number];

export function AiSuiteHome() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">AI Suite</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="AI Suite tabs">
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
      {tab === 'Dashboard' && <DashboardTab />}
      {tab === 'AI Brain' && <BrainTab />}
      {tab === 'AI Agents' && <AgentsTab />}
      {tab === 'More' && <MoreTab />}
    </div>
  );
}
