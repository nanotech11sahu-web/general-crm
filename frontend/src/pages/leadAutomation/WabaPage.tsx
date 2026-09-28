import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { MessageCircle, ShieldCheck } from 'lucide-react';
import { getWabaDashboard, setupWaba, updateWabaCompliance, listOptOuts, listWabaTemplates, createWabaTemplate, approveWabaTemplate } from '../../lib/api/waba';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Dashboard', 'Setup', 'Compliance', 'Templates'] as const;
type Tab = (typeof TABS)[number];

export function WabaPage() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">WABA (WhatsApp Official)</h1>
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
      {tab === 'Dashboard' && <DashboardTab />}
      {tab === 'Setup' && <SetupTab />}
      {tab === 'Compliance' && <ComplianceTab />}
      {tab === 'Templates' && <TemplatesTab />}
    </div>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['waba-dashboard'], queryFn: getWabaDashboard });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Status</p>
        <Badge tone={data.account.status === 'connected' ? 'success' : 'neutral'} className="mt-1">
          {data.account.status}
        </Badge>
      </Card>
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Quality Rating</p>
        <p className="mt-1 text-xl font-semibold capitalize">{data.account.qualityRating ?? '—'}</p>
      </Card>
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Tier / Limit</p>
        <p className="mt-1 text-sm font-semibold">{data.account.tier ?? '—'}</p>
      </Card>
      <Card>
        <p className="text-sm text-[var(--color-text-muted)]">Opted-out Contacts</p>
        <p className="mt-1 text-xl font-semibold">{data.optOutCount}</p>
      </Card>
    </div>
  );
}

function SetupTab() {
  const queryClient = useQueryClient();
  const [onboardingType, setOnboardingType] = useState<'own_number' | 'coexistence'>('own_number');
  const [billingMode, setBillingMode] = useState<'byob' | 'credit_line'>('credit_line');

  const mutation = useMutation({
    mutationFn: () => setupWaba({ onboardingType, billingMode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waba-dashboard'] });
      toast('WABA connected', { variant: 'success' });
    },
  });

  return (
    <Card className="max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-[var(--color-primary)]" />
        <p className="text-sm text-[var(--color-text-muted)]">Meta Embedded Signup flow (stub) — choose your onboarding path below.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Onboarding Type</legend>
        {(['own_number', 'coexistence'] as const).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={onboardingType === opt} onChange={() => setOnboardingType(opt)} />
            {opt === 'own_number' ? 'Own Number' : 'Coexistence'}
          </label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Billing Mode</legend>
        {(['byob', 'credit_line'] as const).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={billingMode === opt} onChange={() => setBillingMode(opt)} />
            {opt === 'byob' ? 'Bring Your Own Billing' : 'Credit-Line (against wallet)'}
          </label>
        ))}
      </fieldset>
      <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Connect WABA
      </Button>
    </Card>
  );
}

function ComplianceTab() {
  const queryClient = useQueryClient();
  const { data: dashboard } = useQuery({ queryKey: ['waba-dashboard'], queryFn: getWabaDashboard });
  const { data: optOuts, isLoading } = useQuery({ queryKey: ['waba-opt-outs'], queryFn: listOptOuts });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => updateWabaCompliance(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waba-dashboard'] });
      toast('Compliance settings updated', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
          <div>
            <p className="text-sm font-medium">Auto Opt-Out Keywords</p>
            <p className="text-xs text-[var(--color-text-muted)]">STOP · UNSUBSCRIBE · CANCEL · QUIT · END</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dashboard?.account.autoOptOutEnabled ?? true}
            onChange={(e) => toggleMutation.mutate(e.target.checked)}
          />
          Enabled
        </label>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Opt-in Registry</h3>
        {isLoading ? (
          <SkeletonList rows={2} />
        ) : optOuts?.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No opt-outs recorded yet.</p>
        ) : (
          <div className="space-y-1.5">
            {optOuts?.map((o) => (
              <div key={o._id} className="flex items-center justify-between text-sm">
                <span>{o.contactId?.name}</span>
                <Badge tone="danger">{o.keyword}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TemplatesTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const { data: templates, isLoading } = useQuery({ queryKey: ['waba-templates'], queryFn: listWabaTemplates });

  const createMutation = useMutation({
    mutationFn: () => createWabaTemplate(name, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waba-templates'] });
      setName('');
      setBody('');
      toast('Template submitted for approval', { variant: 'success' });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveWabaTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waba-templates'] }),
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h3 className="font-semibold">Create Template</h3>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Body" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button size="sm" disabled={!name || !body} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Submit for Approval
        </Button>
      </Card>

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : templates?.length === 0 ? (
        <EmptyState icon={MessageCircle} title="No templates yet" />
      ) : (
        <div className="space-y-2">
          {templates?.map((t) => (
            <Card key={t._id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{t.body}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={t.status === 'approved' ? 'success' : 'warning'}>{t.status.replace('_', ' ')}</Badge>
                {t.status === 'pending_approval' && (
                  <Button size="sm" variant="secondary" onClick={() => approveMutation.mutate(t._id)}>
                    Approve
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
