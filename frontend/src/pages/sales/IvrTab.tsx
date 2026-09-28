import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Phone, PhoneCall, PhoneMissed, Clock3, Users, UserCheck } from 'lucide-react';
import { getIvrOverview, listCalls, listAgents, listProviders, connectProvider, dial } from '../../lib/api/ivr';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Call Logs', 'Agents', 'Recordings', 'Providers'] as const;
type Tab = (typeof TABS)[number];

export function IvrTab() {
  const [tab, setTab] = useState<Tab>('Call Logs');
  const [dialNumber, setDialNumber] = useState('');
  const queryClient = useQueryClient();

  const { data: kpis, isLoading } = useQuery({ queryKey: ['ivr-overview'], queryFn: getIvrOverview });

  const dialMutation = useMutation({
    mutationFn: () => dial({ toNumber: dialNumber }),
    onSuccess: () => {
      setDialNumber('');
      queryClient.invalidateQueries({ queryKey: ['ivr-overview'] });
      queryClient.invalidateQueries({ queryKey: ['ivr-calls'] });
      queryClient.invalidateQueries({ queryKey: ['sales-leaderboard'] });
      toast('Call logged', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Enter number to dial" value={dialNumber} onChange={(e) => setDialNumber(e.target.value)} className="max-w-xs" />
        <Button size="sm" className="gap-1.5" disabled={!dialNumber} loading={dialMutation.isPending} onClick={() => dialMutation.mutate()}>
          <Phone className="h-4 w-4" /> Dial
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <KpiCard icon={PhoneCall} label="Total Calls" value={kpis?.totalCalls ?? 0} />
          <KpiCard icon={PhoneCall} label="Connected" value={kpis?.connected ?? 0} />
          <KpiCard icon={PhoneMissed} label="Missed" value={kpis?.missed ?? 0} />
          <KpiCard icon={Clock3} label="Talk Time" value={`${Math.round((kpis?.talkTimeSeconds ?? 0) / 60)}m`} />
          <KpiCard icon={Users} label="Unique Clients" value={kpis?.uniqueClients ?? 0} />
          <KpiCard icon={UserCheck} label="Agents Active" value={kpis?.agentsActive ?? 0} />
        </div>
      )}

      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Call Logs' && <CallLogsTab />}
      {tab === 'Agents' && <AgentsTab />}
      {tab === 'Recordings' && <EmptyState icon={Phone} title="No recordings yet" description="Recordings appear once a connected provider streams call audio." />}
      {tab === 'Providers' && <ProvidersTab />}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string | number }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        <Icon className="h-4 w-4" /> <p className="text-xs">{label}</p>
      </div>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </Card>
  );
}

function CallLogsTab() {
  const { data: calls, isLoading } = useQuery({ queryKey: ['ivr-calls'], queryFn: () => listCalls() });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!calls?.length) return <EmptyState icon={Phone} title="No calls yet" description="Dial a number above to log your first call." />;
  return (
    <div className="space-y-2">
      {calls.map((c) => (
        <Card key={c._id} className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">{c.toNumber}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {c.direction} · {new Date(c.createdAt).toLocaleString()} · {c.durationSeconds}s
            </p>
          </div>
          <Badge tone={c.status === 'completed' ? 'success' : c.status === 'missed' ? 'danger' : 'neutral'}>{c.status}</Badge>
        </Card>
      ))}
    </div>
  );
}

function AgentsTab() {
  const { data: agents, isLoading } = useQuery({ queryKey: ['ivr-agents'], queryFn: listAgents });
  if (isLoading) return <SkeletonList rows={2} />;
  if (!agents?.length) return <EmptyState icon={Users} title="No agents yet" />;
  return (
    <div className="space-y-2">
      {agents.map((a) => (
        <Card key={a._id} className="flex items-center justify-between text-sm">
          <span>{a.userId?.name ?? a.userId?.email}</span>
        </Card>
      ))}
    </div>
  );
}

function ProvidersTab() {
  const queryClient = useQueryClient();
  const { data: providers, isLoading } = useQuery({ queryKey: ['ivr-providers'], queryFn: listProviders });

  const connectMutation = useMutation({
    mutationFn: (key: string) => connectProvider(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ivr-providers'] });
      toast('Provider connected', { variant: 'success' });
    },
  });

  if (isLoading) return <SkeletonList rows={2} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {providers?.map((p) => (
        <Card key={p.key} className="flex items-center justify-between">
          <p className="font-medium">{p.name}</p>
          {p.connected ? (
            <Badge tone="success">Connected</Badge>
          ) : (
            <Button size="sm" variant="secondary" loading={connectMutation.isPending} onClick={() => connectMutation.mutate(p.key)}>
              Connect
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
