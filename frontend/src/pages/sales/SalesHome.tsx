import { useState } from 'react';
import clsx from 'clsx';
import { PerformanceTab } from './PerformanceTab';
import { WebinarsTab } from './WebinarsTab';
import { IvrTab } from './IvrTab';
import { ProposalsTab } from './ProposalsTab';

const TABS = ['Performance', 'Webinars', 'IVR Calling', 'Proposal Builder'] as const;
type Tab = (typeof TABS)[number];

export function SalesHome() {
  const [tab, setTab] = useState<Tab>('Performance');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Sales</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Sales tabs">
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
      {tab === 'Performance' && <PerformanceTab />}
      {tab === 'Webinars' && <WebinarsTab />}
      {tab === 'IVR Calling' && <IvrTab />}
      {tab === 'Proposal Builder' && <ProposalsTab />}
    </div>
  );
}
