import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';
import { Users, TrendingUp, Calendar, MapPin, Target, Layers } from 'lucide-react';
import { getContactStats } from '../../lib/api/contactStats';
import { Card } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';

const KPI_ICONS = [Users, TrendingUp, Calendar, Target, MapPin, Layers];

export function StatsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['contact-stats'], queryFn: () => getContactStats() });

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-6 w-16" />
          </Card>
        ))}
      </div>
    );
  }

  const kpiTiles = [
    { label: 'New Contacts', value: data.kpis.newContacts },
    { label: 'Daily Average', value: data.kpis.dailyAverage },
    { label: 'Peak Day', value: data.kpis.peakDay ? `${data.kpis.peakDay.date} (${data.kpis.peakDay.count})` : '—' },
    { label: 'Top Source', value: data.kpis.topSource ?? '—' },
    { label: 'Top City', value: data.kpis.topCity ?? '—' },
    { label: 'Unique Sources', value: data.kpis.uniqueSources },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {kpiTiles.map((kpi, i) => {
          const Icon = KPI_ICONS[i];
          return (
            <Card key={kpi.label}>
              <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                <Icon className="h-4 w-4" aria-hidden />
                <p className="text-sm">{kpi.label}</p>
              </div>
              <p className="mt-1 text-xl font-semibold">{kpi.value}</p>
            </Card>
          );
        })}
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Acquisition Funnel</h3>
        <div className="flex flex-wrap items-center gap-2">
          {data.funnel.map((step, i) => (
            <div key={step.step} className="flex items-center gap-2">
              <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-3 py-2 text-center">
                <p className="text-xs text-[var(--color-text-muted)]">{step.step}</p>
                <p className="text-lg font-semibold">{step.count}</p>
              </div>
              {i < data.funnel.length - 1 && <span className="text-[var(--color-text-muted)]">→</span>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">New Contacts Over Time</h3>
        {data.dailySeries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No contacts created in this range yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.dailySeries}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Source Leaderboard</h3>
          {data.sourceLeaderboard.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No source data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.sourceLeaderboard} layout="vertical">
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="source" width={90} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--color-primary)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Top Cities</h3>
          {data.cityLeaderboard.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No city data yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.cityLeaderboard.map((c) => (
                <li key={c.city} className="flex items-center justify-between text-sm">
                  <span>{c.city}</span>
                  <span className="font-medium text-[var(--color-text-muted)]">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
