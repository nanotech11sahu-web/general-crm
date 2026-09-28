import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { listFinanceProducts } from '../../lib/api/finance';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';

export function ProductsTab() {
  const { data: products, isLoading } = useQuery({ queryKey: ['finance-products'], queryFn: listFinanceProducts });

  if (isLoading) return <SkeletonList rows={4} />;
  if (!products?.length) {
    return <EmptyState icon={Package} title="No products yet" description="Products created in Ecom, Community Courses, or the Digital Store all show up here — one shared object, one source of truth." />;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">
        Products are a single shared object across Ecom, Community Courses, and the Digital Store — creating one anywhere shows up here correctly priced.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <Card key={p._id} className="space-y-1.5">
            <div className="flex items-start justify-between">
              <p className="font-medium">{p.name}</p>
              <Badge>{p.source}</Badge>
            </div>
            <p className="text-lg font-semibold">
              {p.currency} {p.salePrice.toLocaleString()}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
