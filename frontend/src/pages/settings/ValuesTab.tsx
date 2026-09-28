import { useQuery } from '@tanstack/react-query';
import { listCustomFields } from '../../lib/api/settings';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';

const STANDARD_MERGE_TAGS = [
  { object: 'Contact', field: 'name' },
  { object: 'Contact', field: 'email' },
  { object: 'Contact', field: 'phone' },
  { object: 'Contact', field: 'company' },
];

export function ValuesTab() {
  const { data: fields, isLoading } = useQuery({ queryKey: ['settings-fields'], queryFn: () => listCustomFields() });
  if (isLoading) return <SkeletonList rows={2} />;

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h4 className="font-semibold">Standard Merge Tags</h4>
        <p className="text-sm text-[var(--color-text-muted)]">Read-only reference — use these in templates and messages.</p>
        <div className="flex flex-wrap gap-2">
          {STANDARD_MERGE_TAGS.map((t) => (
            <code key={t.field} className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs">{`{{${t.object.toLowerCase()}.${t.field}}}`}</code>
          ))}
        </div>
      </Card>
      <Card className="space-y-2">
        <h4 className="font-semibold">Custom Field Merge Tags</h4>
        <p className="text-sm text-[var(--color-text-muted)]">Pulled live from Fields — add a field there and it appears here automatically.</p>
        <div className="flex flex-wrap gap-2">
          {(fields ?? []).length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No custom fields yet.</p>}
          {(fields ?? []).map((f) => (
            <code key={f._id} className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs">{`{{${f.objectType.toLowerCase()}.custom.${f.label}}}`}</code>
          ))}
        </div>
      </Card>
    </div>
  );
}
