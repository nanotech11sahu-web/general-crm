import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listDeletedItems, restoreDeletedItem, purgeDeletedItem } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import { Trash2 } from 'lucide-react';

export function DeletedItemsTab() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useQuery({ queryKey: ['deleted-items'], queryFn: listDeletedItems });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreDeletedItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deleted-items'] });
      toast('Item restored', { variant: 'success' });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => purgeDeletedItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deleted-items'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  if ((items ?? []).length === 0) {
    return <EmptyState icon={Trash2} title="Nothing deleted" description="Deleted records across every module land here for 30 days before permanent purge." />;
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
          <tr>
            <th className="p-3">Module</th>
            <th className="p-3">Collection</th>
            <th className="p-3">Deleted</th>
            <th className="p-3">Purges</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {(items ?? []).map((item) => (
            <tr key={item._id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="p-3">
                <Badge>{item.module}</Badge>
              </td>
              <td className="p-3">{item.originalCollection}</td>
              <td className="p-3">{new Date(item.deletedAt).toLocaleString()}</td>
              <td className="p-3">{new Date(item.purgeAt).toLocaleDateString()}</td>
              <td className="p-3 text-right">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" loading={restoreMutation.isPending} onClick={() => restoreMutation.mutate(item._id)}>
                    Restore
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => purgeMutation.mutate(item._id)}>
                    Delete Forever
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
