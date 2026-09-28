import { useQuery } from '@tanstack/react-query';
import { GitBranch, Layers } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { listPipelines, listOpportunities } from '../../lib/api/pipelines';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import type { Opportunity, Pipeline } from '../../types/crm';

const STAGE_COLORS = ['#7c3aed', '#059669', '#d97706', '#e11d48', '#2563eb', '#0891b2', '#64748b', '#db2777'];

function formatCurrency(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  const { data: opportunities, isLoading } = useQuery({
    queryKey: ['opportunities', pipeline._id],
    queryFn: () => listOpportunities(pipeline._id),
  });

  const stages = pipeline.stages.slice().sort((a, b) => a.order - b.order);
  const opps: Opportunity[] = opportunities ?? [];
  const totalCount = opps.length;
  const totalValue = opps.reduce((sum, o) => sum + (o.value ?? 0), 0);

  const stageData = stages.map((stage, i) => {
    const stageOpps = opps.filter((o) => o.stageKey === stage.key);
    return {
      key: stage.key,
      label: stage.label,
      count: stageOpps.length,
      value: stageOpps.reduce((sum, o) => sum + (o.value ?? 0), 0),
      color: STAGE_COLORS[i % STAGE_COLORS.length],
    };
  });

  const recentOpportunities = opps
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <GitBranch className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="font-semibold">{pipeline.name}</h3>
          {pipeline.isDefault && <Badge tone="success">Default</Badge>}
        </div>
        <div className="flex gap-4 text-right">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Opportunities</p>
            <p className="font-semibold tabular-nums">{totalCount}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Pipeline Value</p>
            <p className="font-semibold tabular-nums">{formatCurrency(totalValue)}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={2} />
      ) : totalCount === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No opportunities in this pipeline yet.</p>
      ) : (
        <>
          {/* Segmented stage-share bar, like a payment-status breakdown */}
          <div className="space-y-1.5">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
              {stageData.map((s) =>
                s.count > 0 ? (
                  <div
                    key={s.key}
                    style={{ width: `${(s.count / totalCount) * 100}%`, backgroundColor: s.color }}
                    title={`${s.label}: ${s.count}`}
                  />
                ) : null,
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {stageData.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label} · {s.count} ({totalCount ? Math.round((s.count / totalCount) * 100) : 0}%)
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={stageData} dataKey="count" nameKey="label" innerRadius={55} outerRadius={80} paddingAngle={2}>
                    {stageData.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h4 className="mb-2 text-sm font-semibold">Recent Opportunities</h4>
              <div className="space-y-1.5">
                {recentOpportunities.map((o) => (
                  <div key={o._id} className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{o.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{stages.find((s) => s.key === o.stageKey)?.label ?? o.stageKey}</p>
                    </div>
                    {typeof o.value === 'number' && <span className="shrink-0 font-medium">{formatCurrency(o.value)}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

export function PipelinePage() {
  const { data: pipelines, isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: listPipelines });

  if (isLoading) return <SkeletonList rows={3} />;
  if (!pipelines || pipelines.length === 0) {
    return <EmptyState icon={Layers} title="No pipelines yet" description="Create a pipeline to start tracking deals through stages." />;
  }

  return (
    <div className="space-y-4">
      {pipelines.map((pipeline) => (
        <PipelineCard key={pipeline._id} pipeline={pipeline} />
      ))}
    </div>
  );
}
