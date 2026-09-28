import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import { listPipelines } from '../../lib/api/pipelines';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';

export function PipelinePage() {
  const { data: pipelines, isLoading } = useQuery({ queryKey: ['pipelines'], queryFn: listPipelines });

  if (isLoading) return <SkeletonList rows={3} />;
  if (!pipelines || pipelines.length === 0) {
    return <EmptyState icon={GitBranch} title="No pipelines yet" description="Create a pipeline to start tracking deals through stages." />;
  }

  return (
    <div className="space-y-4">
      {pipelines.map((pipeline) => (
        <Card key={pipeline._id}>
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-[var(--color-primary)]" aria-hidden />
            <h3 className="font-semibold">{pipeline.name}</h3>
            {pipeline.isDefault && <Badge tone="success">Default</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            {pipeline.stages
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((stage) => (
                <Badge key={stage.key}>{stage.label}</Badge>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
