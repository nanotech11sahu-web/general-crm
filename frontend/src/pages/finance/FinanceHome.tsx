import { useState } from 'react';
import clsx from 'clsx';
import { DashboardTab } from './DashboardTab';
import { ProductsTab } from './ProductsTab';
import { BillingTab } from './BillingTab';
import { MoreTab } from './MoreTab';

const TABS = ['Dashboard', 'Products', 'Billing', 'More'] as const;
type Tab = (typeof TABS)[number];

export function FinanceHome() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Finance</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Finance tabs">
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
      {tab === 'Products' && <ProductsTab />}
      {tab === 'Billing' && <BillingTab />}
      {tab === 'More' && <MoreTab />}
    </div>
  );
}
