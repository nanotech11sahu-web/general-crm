import { useQuery } from '@tanstack/react-query';
import { getAnalytics } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';

export function AnalyticsTab() {
  const { data: tiles, isLoading } = useQuery({ queryKey: ['analytics-tiles'], queryFn: getAnalytics });
  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(tiles ?? []).map((tile) => (
        <Card key={tile.key} className="text-center">
          <p className="text-xs text-[var(--color-text-muted)]">{tile.label}</p>
          <p className="text-xl font-semibold">{tile.value === null ? '—' : tile.value.toLocaleString()}</p>
        </Card>
      ))}
    </div>
  );
}
