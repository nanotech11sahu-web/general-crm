import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { listCustomFields, createCustomField, deleteCustomField } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const FIELD_TYPES = ['single_line', 'multi_line', 'phone', 'dropdown_single', 'date_picker', 'file_upload'] as const;
const OBJECT_TYPES = ['Contact', 'Project', 'Course', 'Student'] as const;

export function FieldsTab() {
  const queryClient = useQueryClient();
  const { data: fields, isLoading } = useQuery({ queryKey: ['settings-fields'], queryFn: () => listCustomFields() });
  const [objectType, setObjectType] = useState<(typeof OBJECT_TYPES)[number]>('Contact');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<(typeof FIELD_TYPES)[number]>('single_line');

  const createMutation = useMutation({
    mutationFn: () => createCustomField({ objectType, label, type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings-fields'] });
      setLabel('');
      toast('Field added', { variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomField(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings-fields'] }),
  });

  if (isLoading) return <SkeletonList rows={3} />;

  const standard = (fields ?? []).filter((f) => f.isStandard);
  const additional = (fields ?? []).filter((f) => !f.isStandard);

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h4 className="font-semibold">Add Field</h4>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Object</label>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={objectType} onChange={(e) => setObjectType(e.target.value as (typeof OBJECT_TYPES)[number])}>
              {OBJECT_TYPES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Type</label>
            <select className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm" value={type} onChange={(e) => setType(e.target.value as (typeof FIELD_TYPES)[number])}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" disabled={!label} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" /> Add Field
          </Button>
        </div>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Standard</h4>
        <div className="flex flex-wrap gap-2">
          {standard.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">None seeded yet.</p>}
          {standard.map((f) => (
            <Badge key={f._id}>{f.label}</Badge>
          ))}
        </div>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Additional</h4>
        <div className="space-y-1">
          {additional.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No custom fields yet.</p>}
          {additional.map((f) => (
            <div key={f._id} className="flex items-center justify-between text-sm">
              <span>
                {f.label} <span className="text-[var(--color-text-muted)]">({f.objectType} · {f.type})</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(f._id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
