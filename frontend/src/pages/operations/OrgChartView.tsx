import { useQuery } from '@tanstack/react-query';
import { getOrgChart } from '../../lib/api/hrm';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';
import type { OrgChartNode } from '../../types/operations';

function TreeNode({ node }: { node: OrgChartNode }) {
  return (
    <li>
      <div className="inline-flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm">
        <span className="font-medium">{node.name}</span>
        {node.jobTitle && <span className="text-xs text-[var(--color-text-muted)]">{node.jobTitle}</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-6 mt-2 space-y-2 border-l border-[var(--color-border)] pl-4">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartView() {
  const { data, isLoading } = useQuery({ queryKey: ['hrm-org-chart'], queryFn: getOrgChart });
  if (isLoading || !data) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Total Staff', data.kpis.totalStaff],
          ['Human', data.kpis.humanCount],
          ['AI Agents', data.kpis.aiAgentCount],
          ['Departments', data.kpis.departmentCount],
          ['Teams', data.kpis.teamCount],
          ['Depth', data.kpis.depth],
        ].map(([label, value]) => (
          <Card key={label as string} className="text-center">
            <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
            <p className="text-xl font-semibold">{value}</p>
          </Card>
        ))}
      </div>
      <Card>
        <ul>
          <TreeNode node={data.tree} />
        </ul>
      </Card>
    </div>
  );
}
