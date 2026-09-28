import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listTemplates, createTemplate, deleteTemplate } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const CATEGORIES = ['Notes', 'Outreach', 'Email', 'WhatsApp', 'WhatsApp Business', 'Follow-up'] as const;

export function TemplatesTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['settings-templates'], queryFn: () => listTemplates() });
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Notes');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createTemplate({ category, name, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-templates'] });
      setName('');
      setContent('');
      toast('Template created', { variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTemplate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings-templates'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Category</label>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <textarea
          className="min-h-20 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm outline-none focus:border-[var(--color-primary)]"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Template content…"
        />
        <Button size="sm" disabled={!name || !content} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          <Plus className="h-4 w-4" /> Create Template
        </Button>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {(data?.templates ?? []).map((t) => (
          <Card key={t._id} className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="font-medium">{t.name}</p>
              <Badge>{t.category}</Badge>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">{t.content}</p>
            <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(t._id)}>
              Delete
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
