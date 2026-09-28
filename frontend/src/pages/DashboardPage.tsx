import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Eye, EyeOff, Clock } from 'lucide-react';
import { OnboardingBanner } from '../components/dashboard/OnboardingBanner';
import { Card } from '../components/ui/Card';
import { getDashboard, getDashboardStaff, getDashboardLayout, saveDashboardLayout, type DashboardKpi } from '../lib/api/dashboard';

function formatKpiValue(kpi: DashboardKpi): string {
  if (kpi.value === null) return '—';
  if (kpi.format === 'currency') return `₹${Number(kpi.value).toLocaleString('en-IN')}`;
  if (kpi.format === 'percent') return `${kpi.value}%`;
  return String(kpi.value);
}

function startOfMonthISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [staffId, setStaffId] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);

  const { data: staff } = useQuery({ queryKey: ['dashboard-staff'], queryFn: getDashboardStaff });
  const { data: layout } = useQuery({ queryKey: ['dashboard-layout'], queryFn: getDashboardLayout });
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', from, to, staffId],
    queryFn: () => getDashboard({ from, to, staffMembershipId: staffId || undefined }),
  });

  const allKpis = useMemo(() => data?.groups.flatMap((g) => g.kpis.map((k) => ({ ...k, group: g.group }))) ?? [], [data]);

  useEffect(() => {
    if (allKpis.length === 0) return;
    const savedOrder = layout?.map((l) => l.key) ?? [];
    const known = new Set(allKpis.map((k) => k.key));
    const ordered = [...savedOrder.filter((k) => known.has(k)), ...allKpis.map((k) => k.key).filter((k) => !savedOrder.includes(k))];
    setOrder(ordered);
    setHidden(new Set((layout ?? []).filter((l) => !l.visible).map((l) => l.key)));
  }, [allKpis, layout]);

  const layoutMutation = useMutation({
    mutationFn: saveDashboardLayout,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard-layout'] }),
  });

  function persistLayout(nextOrder: string[], nextHidden: Set<string>) {
    layoutMutation.mutate(nextOrder.map((key) => ({ key, visible: !nextHidden.has(key) })));
  }

  function toggleHidden(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    persistLayout(order, next);
  }

  function handleDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    const next = [...order];
    const from_ = next.indexOf(dragKey);
    const to_ = next.indexOf(targetKey);
    next.splice(from_, 1);
    next.splice(to_, 0, dragKey);
    setOrder(next);
    setDragKey(null);
    persistLayout(next, hidden);
  }

  const kpiByKey = new Map(allKpis.map((k) => [k.key, k]));
  const orderedKpis = order.map((key) => kpiByKey.get(key)).filter((k): k is DashboardKpi => Boolean(k));

  return (
    <div className="space-y-4">
      <OnboardingBanner />

      <Card className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs text-[var(--color-text-muted)]">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-text-muted)]">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-[var(--color-text-muted)]">Staff</label>
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          >
            <option value="">All staff</option>
            {staff?.map((s) => (
              <option key={s._id} value={s._id}>
                {s.userId?.name ?? 'Unknown'}
              </option>
            ))}
          </select>
        </div>
        {data?.timezone && (
          <div className="ml-auto flex items-center gap-1.5 text-sm text-[var(--color-text-muted)]">
            <Clock className="h-4 w-4" aria-hidden />
            {data.timezone}
          </div>
        )}
      </Card>

      {isLoading ? (
        <Card>Loading KPIs…</Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {orderedKpis.map((kpi) => (
            <Card
              key={kpi.key}
              draggable
              onDragStart={() => setDragKey(kpi.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(kpi.key)}
              className={hidden.has(kpi.key) ? 'opacity-40' : undefined}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{kpi.group}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{kpi.label}</p>
                </div>
                <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
                  <button type="button" aria-label={hidden.has(kpi.key) ? `Show ${kpi.label}` : `Hide ${kpi.label}`} onClick={() => toggleHidden(kpi.key)}>
                    {hidden.has(kpi.key) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <GripVertical className="h-3.5 w-3.5 cursor-grab" aria-hidden />
                </div>
              </div>
              {!hidden.has(kpi.key) && <p className="mt-2 text-2xl font-semibold">{formatKpiValue(kpi)}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
