import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from 'recharts';
import { Users, TrendingUp, CalendarDays, Target, MapPin, Layers } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getContactStats } from '../../lib/api/contactStats';
import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatCard, type StatTone } from '../../components/leadManagement/StatCard';

const KPI_META: { key: string; label: string; icon: typeof Users; tone: StatTone }[] = [
  { key: 'newContacts', label: 'New Leads', icon: Users, tone: 'violet' },
  { key: 'dailyAverage', label: 'Daily Average', icon: TrendingUp, tone: 'emerald' },
  { key: 'peakDay', label: 'Peak Day', icon: CalendarDays, tone: 'amber' },
  { key: 'topSource', label: 'Top Source', icon: Target, tone: 'rose' },
  { key: 'topCity', label: 'Top City', icon: MapPin, tone: 'blue' },
  { key: 'uniqueSources', label: 'Unique Sources', icon: Layers, tone: 'cyan' },
];

export function StatsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['contact-stats'], queryFn: () => getContactStats() });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="h-32">
            <Skeleton className="h-11 w-11 rounded-2xl" />
            <Skeleton className="mt-4 h-4 w-24" />
            <Skeleton className="mt-2 h-6 w-16" />
          </Card>
        ))}
      </div>
    );
  }

  const sparkline = data.dailySeries.map((d) => d.count);

  const kpiValues: Record<string, string | number> = {
    newContacts: data.kpis.newContacts,
    dailyAverage: data.kpis.dailyAverage,
    peakDay: data.kpis.peakDay ? `${data.kpis.peakDay.date} (${data.kpis.peakDay.count})` : '—',
    topSource: data.kpis.topSource ?? '—',
    topCity: data.kpis.topCity ?? '—',
    uniqueSources: data.kpis.uniqueSources,
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {KPI_META.map((kpi) => (
          <StatCard
            key={kpi.key}
            icon={kpi.icon}
            tone={kpi.tone}
            label={kpi.label}
            value={kpiValues[kpi.key]}
            sparkline={kpi.key === 'newContacts' ? sparkline : undefined}
            onViewAll={() => navigate('/lead-management/leads')}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">New Leads Over Time</h3>
              <p className="text-sm text-[var(--color-text-muted)]">Daily lead volume for the selected range.</p>
            </div>
          </div>
          {data.dailySeries.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-text-muted)]">No leads created in this range yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={data.dailySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area type="monotone" dataKey="count" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h3 className="mb-1 font-semibold">Acquisition Funnel</h3>
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">Where leads are in the journey.</p>
          <div className="space-y-2">
            {data.funnel.map((step) => (
              <div key={step.step} className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-3 py-2">
                <span className="text-sm">{step.step}</span>
                <span className="text-sm font-semibold">{step.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-1 font-semibold">Source Leaderboard</h3>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">Which channels bring in the most leads.</p>
          {data.sourceLeaderboard.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No source data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.sourceLeaderboard} layout="vertical">
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--color-primary)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h3 className="mb-1 font-semibold">Top Cities</h3>
          <p className="mb-3 text-sm text-[var(--color-text-muted)]">Geographic concentration of your leads.</p>
          {data.cityLeaderboard.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No city data yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.cityLeaderboard.map((c) => (
                <li key={c.city} className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
                  <span>{c.city}</span>
                  <span className="font-semibold">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
