import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Network, Plus, ArrowRightLeft } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { getAgency, createAgency, createSubAccount, getAgencyRollup, switchWorkspace } from '../../lib/api/agency';
import { useAuthStore } from '../../stores/authStore';

function formatKpiValue(value: number | string | null, format: string): string {
  if (value === null) return '—';
  if (format === 'currency') return `₹${Number(value).toLocaleString('en-IN')}`;
  if (format === 'percent') return `${value}%`;
  return String(value);
}

export function AgencyHome() {
  const queryClient = useQueryClient();
  const workspaceId = useAuthStore((s) => s.workspaceId);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setWorkspaceId = useAuthStore((s) => s.setWorkspaceId);

  const [agencyModalOpen, setAgencyModalOpen] = useState(false);
  const [subAccountModalOpen, setSubAccountModalOpen] = useState(false);
  const [agencyName, setAgencyName] = useState('');
  const [subAccountName, setSubAccountName] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['agency'], queryFn: getAgency });

  const rollupQuery = useQuery({
    queryKey: ['agency', 'rollup'],
    queryFn: getAgencyRollup,
    enabled: Boolean(data?.agency),
  });

  const createAgencyMutation = useMutation({
    mutationFn: () => createAgency(agencyName),
    onSuccess: () => {
      setAgencyModalOpen(false);
      setAgencyName('');
      queryClient.invalidateQueries({ queryKey: ['agency'] });
    },
  });

  const createSubAccountMutation = useMutation({
    mutationFn: () => createSubAccount(subAccountName),
    onSuccess: () => {
      setSubAccountModalOpen(false);
      setSubAccountName('');
      queryClient.invalidateQueries({ queryKey: ['agency'] });
    },
  });

  const switchMutation = useMutation({
    mutationFn: (targetWorkspaceId: string) => switchWorkspace(targetWorkspaceId),
    onSuccess: (tokens, targetWorkspaceId) => {
      setTokens(tokens.accessToken, tokens.refreshToken);
      setWorkspaceId(targetWorkspaceId);
      window.location.href = '/';
    },
  });

  if (isLoading) return <Card>Loading…</Card>;

  if (!data?.agency) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Network}
          title="Turn this workspace into an agency"
          description="An agency account can spin up and manage multiple sub-account workspaces, with a rollup report across all of them."
          actionLabel="Become an agency"
          onAction={() => setAgencyModalOpen(true)}
        />
        <Modal open={agencyModalOpen} onClose={() => setAgencyModalOpen(false)} title="Name your agency">
          <div className="space-y-4">
            <Input label="Agency name" value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="Acme Agency" />
            <Button className="w-full" loading={createAgencyMutation.isPending} onClick={() => createAgencyMutation.mutate()} disabled={!agencyName.trim()}>
              Create agency
            </Button>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{data.agency.name}</h1>
          <p className="text-sm text-[var(--color-text-muted)]">{data.workspaces.length} workspace(s) in this agency</p>
        </div>
        <Button onClick={() => setSubAccountModalOpen(true)}>
          <Plus className="h-4 w-4" /> New sub-account
        </Button>
      </div>

      <Card>
        <h2 className="mb-3 font-semibold">Sub-accounts</h2>
        <div className="divide-y divide-[var(--color-border)]">
          {data.workspaces.map((ws) => (
            <div key={ws._id} className="flex items-center justify-between py-2.5">
              <span className="text-sm font-medium">{ws.name}</span>
              {ws._id === workspaceId ? (
                <span className="text-xs text-[var(--color-text-muted)]">Current workspace</span>
              ) : (
                <Button size="sm" variant="secondary" loading={switchMutation.isPending} onClick={() => switchMutation.mutate(ws._id)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Switch to this
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Cross-workspace rollup — this month</h2>
        {rollupQuery.data && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(rollupQuery.data.totals).map(([key, value]) => (
              <div key={key} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <p className="text-xs text-[var(--color-text-muted)]">{key}</p>
                <p className="mt-1 text-lg font-semibold">{formatKpiValue(value, 'number')}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={subAccountModalOpen} onClose={() => setSubAccountModalOpen(false)} title="Create a sub-account">
        <div className="space-y-4">
          <Input label="Client / sub-account name" value={subAccountName} onChange={(e) => setSubAccountName(e.target.value)} placeholder="Client Co" />
          <Button className="w-full" loading={createSubAccountMutation.isPending} onClick={() => createSubAccountMutation.mutate()} disabled={!subAccountName.trim()}>
            Create sub-account
          </Button>
        </div>
      </Modal>
    </div>
  );
}
