import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listTags, createTag, updateTag, deleteTag } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function TagsTab() {
  const queryClient = useQueryClient();
  const { data: tags, isLoading } = useQuery({ queryKey: ['settings-tags'], queryFn: listTags });
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createTag({ name, appliesTo: ['Contact'], category: category || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-tags'] });
      setName('');
      setCategory('');
      toast('Tag created', { variant: 'success' });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: ({ id, order }: { id: string; order: number }) => updateTag(id, { order }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings-tags'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings-tags'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  const sorted = (tags ?? []).slice().sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Lifecycle, Priority…" />
        <Button size="sm" disabled={!name} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Add Tag
        </Button>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Name</th>
              <th className="p-3">Category</th>
              <th className="p-3">Usage</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((tag, i) => (
              <tr key={tag._id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="p-3">
                  <div className="flex gap-1">
                    <button type="button" disabled={i === 0} onClick={() => reorderMutation.mutate({ id: tag._id, order: tag.order - 1 })}>
                      ↑
                    </button>
                    <button type="button" disabled={i === sorted.length - 1} onClick={() => reorderMutation.mutate({ id: tag._id, order: tag.order + 1 })}>
                      ↓
                    </button>
                  </div>
                </td>
                <td className="p-3">
                  <Badge style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>{tag.name}</Badge>
                </td>
                <td className="p-3 text-[var(--color-text-muted)]">{tag.category ?? '—'}</td>
                <td className="p-3">{tag.usageCount}</td>
                <td className="p-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(tag._id)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
