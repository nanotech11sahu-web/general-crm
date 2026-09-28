import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Megaphone, Radio } from 'lucide-react';
import { listAdAccounts, connectAdAccount, getAdOverview } from '../../lib/api/adLauncher';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Overview', 'Create'] as const;
type Tab = (typeof TABS)[number];

export function AdLauncherPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Ad Launcher</h1>
      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Overview' && <OverviewTab />}
      {tab === 'Create' && <CreateTab />}
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading } = useQuery({ queryKey: ['ad-overview'], queryFn: getAdOverview });
  if (isLoading) return <SkeletonList rows={4} />;
  if (!data) return null;

  const kpis = [
    { label: 'Amount Spent', value: `₹${data.kpis.spend.toLocaleString()}` },
    { label: 'Leads', value: data.kpis.leads },
    { label: 'CPL', value: `₹${data.kpis.cpl}` },
    { label: 'CTR', value: `${data.kpis.ctr}%` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-sm text-[var(--color-text-muted)]">{k.label}</p>
            <p className="mt-1 text-xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Account Health</h3>
          <span className="text-2xl font-bold">{data.health.healthScore}%</span>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">30% active · 40% delivering · 30% with leads</p>
        {data.health.totalCampaigns === 0 && <p className="mt-2 text-sm text-[var(--color-text-muted)]">No campaigns yet — connect a platform in the Create tab.</p>}
      </Card>
    </div>
  );
}

function CreateTab() {
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useQuery({ queryKey: ['ad-accounts'], queryFn: listAdAccounts });

  const connectMutation = useMutation({
    mutationFn: () => connectAdAccount('meta'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ad-accounts'] });
      toast('Meta account connected', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;
  const metaAccount = accounts?.find((a) => a.platform === 'meta');

  if (!metaAccount || metaAccount.status !== 'connected') {
    return (
      <EmptyState
        icon={Radio}
        title="No ad platform connected"
        description="Connect your Meta Ads account to launch and track campaigns."
        actionLabel="Connect Meta Account"
        onAction={() => connectMutation.mutate()}
      />
    );
  }

  return (
    <Card className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-[var(--color-primary)]" />
        <div>
          <p className="font-medium">Meta Ads</p>
          <p className="text-xs text-[var(--color-text-muted)]">{metaAccount.externalAccountId}</p>
        </div>
      </div>
      <Badge tone="success">Connected</Badge>
    </Card>
  );
}
