import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Trophy, Wallet, Zap, Phone, Clock3, Settings2 } from 'lucide-react';
import { getOverview, getLeaderboard, getIncentiveSettings, saveIncentiveSetting } from '../../lib/api/salesPerformance';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';

const MEDALS = ['🥇', '🥈', '🥉'];

function tierFor(revenue: number): { label: string; tone: 'success' | 'warning' | 'neutral' } {
  if (revenue >= 50000) return { label: 'Platinum', tone: 'success' };
  if (revenue >= 10000) return { label: 'Gold', tone: 'warning' };
  return { label: 'Standard', tone: 'neutral' };
}

export function PerformanceTab() {
  const [view, setView] = useState<'team' | 'my'>('team');
  const [incentiveOpen, setIncentiveOpen] = useState(false);
  const canManageIncentives = useAuthStore((s) => s.permissions?.sales?.edit ?? false);

  const { data: kpis, isLoading: kpisLoading } = useQuery({ queryKey: ['sales-overview', view], queryFn: () => getOverview(view) });
  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery({ queryKey: ['sales-leaderboard', view], queryFn: () => getLeaderboard(view) });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
          {(['team', 'my'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={clsx(
                'rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-sm font-medium',
                view === v ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              {v === 'team' ? 'Team View' : 'My View'}
            </button>
          ))}
        </div>
        {canManageIncentives && (
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setIncentiveOpen(true)}>
            <Settings2 className="h-4 w-4" /> Incentive Settings
          </Button>
        )}
      </div>

      {kpisLoading ? (
        <SkeletonList rows={2} />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard icon={Wallet} label="Verified Revenue" value={`₹${(kpis?.verifiedRevenue ?? 0).toLocaleString()}`} />
          <KpiCard icon={Zap} label="Total Actions" value={String(kpis?.totalActions ?? 0)} />
          <KpiCard icon={Phone} label="Calls Made" value={String(kpis?.callsMade ?? 0)} />
          <KpiCard icon={Clock3} label="Avg Response" value={kpis?.avgResponseSeconds ? `${Math.round(kpis.avgResponseSeconds)}s` : '—'} />
          <KpiCard icon={Trophy} label="Active Now" value={String(kpis?.activeNow ?? 0)} />
        </div>
      )}

      <Card>
        <h3 className="mb-3 font-semibold">Leaderboard</h3>
        <p className="mb-3 text-xs text-[var(--color-text-muted)]">Activity tracking is live — figures update as your team logs calls and revenue.</p>
        {leaderboardLoading ? (
          <SkeletonList rows={3} />
        ) : !leaderboard?.length ? (
          <EmptyState icon={Trophy} title="No activity logged yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-muted)]">
                  <th className="pb-2">Rank</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">💰 Revenue</th>
                  <th className="pb-2">⚡ Actions</th>
                  <th className="pb-2">📞 Calls</th>
                  <th className="pb-2">🕐 Avg Response</th>
                  <th className="pb-2">Tier</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, i) => {
                  const tier = tierFor(row.verifiedRevenue);
                  return (
                    <tr key={row.membershipId} className="border-t border-[var(--color-border)]">
                      <td className="py-2">{MEDALS[i] ?? `#${i + 1}`}</td>
                      <td className="py-2 font-medium">
                        {row.name} {row.activeNow && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" aria-label="Active now" />}
                      </td>
                      <td className="py-2">₹{row.verifiedRevenue.toLocaleString()}</td>
                      <td className="py-2">{row.totalActions}</td>
                      <td className="py-2">{row.callsMade}</td>
                      <td className="py-2">{row.avgResponseSeconds ? `${Math.round(row.avgResponseSeconds)}s` : '—'}</td>
                      <td className="py-2">
                        <Badge tone={tier.tone}>{tier.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <IncentiveSettingsModal open={incentiveOpen} onClose={() => setIncentiveOpen(false)} />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Wallet; label: string; value: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        <Icon className="h-4 w-4" /> <p className="text-sm">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}

function IncentiveSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['incentive-settings'], queryFn: getIncentiveSettings, enabled: open });
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const saveMutation = useMutation({
    mutationFn: (payload: { membershipId: string; incentiveAmount: number }) => saveIncentiveSetting(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incentive-settings'] });
      toast('Incentive saved', { variant: 'success' });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Incentive Settings">
      <div className="space-y-3">
        {data?.memberships.map((m) => {
          const existing = data.settings.find((s) => s.membershipId === m._id);
          const value = drafts[m._id] ?? String(existing?.incentiveAmount ?? 0);
          return (
            <div key={m._id} className="flex items-center gap-2">
              <span className="flex-1 text-sm">{m.userId?.name ?? m.userId?.email ?? 'Team member'}</span>
              <Input
                aria-label={`Incentive for ${m.userId?.name ?? 'team member'}`}
                type="number"
                className="w-28"
                value={value}
                onChange={(e) => setDrafts({ ...drafts, [m._id]: e.target.value })}
              />
              <Button
                size="sm"
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate({ membershipId: m._id, incentiveAmount: Number(value) })}
              >
                Save
              </Button>
            </div>
          );
        })}
        {!data?.memberships.length && <p className="text-sm text-[var(--color-text-muted)]">No staff members yet.</p>}
      </div>
    </Modal>
  );
}
