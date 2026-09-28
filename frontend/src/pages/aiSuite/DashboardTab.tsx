import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { Zap, Bot, MessageSquare, Clock3, CheckCircle2, DollarSign, MessagesSquare, Gauge, Sparkles } from 'lucide-react';
import { getAiDashboard } from '../../lib/api/aiSuite';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';

const RANGE_OPTIONS = [7, 30, 90] as const;

export function DashboardTab() {
  const [days, setDays] = useState<(typeof RANGE_OPTIONS)[number]>(7);
  const { data, isLoading } = useQuery({ queryKey: ['ai-dashboard', days], queryFn: () => getAiDashboard(days) });

  if (isLoading || !data) return <SkeletonList rows={6} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-sm font-medium ${days === d ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]'}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <Card className="flex items-center gap-2 p-2.5">
          <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
          <span className="text-sm font-medium">Advisory Board AI</span>
          <span className="text-xs text-[var(--color-text-muted)]">(coming in a later phase)</span>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Zap} label="Total Tokens" value={data.kpis.totalTokens.toLocaleString()} />
        <KpiCard icon={Bot} label="Active Agents" value={String(data.kpis.activeAgents)} />
        <KpiCard icon={MessageSquare} label="Total Requests" value={String(data.kpis.totalRequests)} />
        <KpiCard icon={Clock3} label="Avg Response Time" value={`${Math.round(data.kpis.avgResponseTimeMs)}ms`} />
        <KpiCard icon={CheckCircle2} label="Success Rate" value={`${Math.round(data.kpis.successRate * 100)}%`} />
        <KpiCard icon={DollarSign} label="Est. Cost" value={`$${data.kpis.estCost.toFixed(4)}`} />
        <KpiCard icon={MessagesSquare} label="Conversations" value={String(data.kpis.conversations)} />
        <KpiCard icon={Gauge} label="Cache Hit Rate" value={`${Math.round(data.kpis.cacheHitRate * 100)}%`} />
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Token Usage ({days}d)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data.tokenUsageChart}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="tokens" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.15} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">Most Used Models</h3>
          {!data.mostUsedModels.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">No requests yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.mostUsedModels.map((m) => (
                <div key={m.model} className="flex items-center justify-between text-sm">
                  <span>
                    {m.model} <span className="text-xs text-[var(--color-text-muted)]">({m.provider})</span>
                  </span>
                  <span>{m.requests} req · {Math.round(m.avgResponseTimeMs)}ms avg</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-semibold">Provider Breakdown</h3>
          {!data.providerBreakdown.length ? (
            <p className="text-sm text-[var(--color-text-muted)]">No requests yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.providerBreakdown.map((p) => (
                <div key={p.provider} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{p.provider}</span>
                  <span>{p.requests} requests</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="mb-1 font-semibold">Avg Tokens / Request</h3>
        <p className="text-2xl font-semibold">{Math.round(data.avgTokensPerRequest)}</p>
      </Card>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value }: { icon: typeof Zap; label: string; value: string }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
        <Icon className="h-4 w-4" /> <p className="text-xs">{label}</p>
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </Card>
  );
}
