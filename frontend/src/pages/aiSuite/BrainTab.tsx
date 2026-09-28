import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, FolderPlus, Plus } from 'lucide-react';
import { listBrainPacks } from '../../lib/api/aiSuite';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function BrainTab() {
  const navigate = useNavigate();
  const { data: packs, isLoading } = useQuery({ queryKey: ['ai-brain-packs'], queryFn: listBrainPacks });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-muted)]">One read-only knowledge pack per module, auto-seeded from your workspace's real data.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => toast('Templates land in a later phase', { variant: 'info' })}>
            Templates
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => toast('Custom folders land in a later phase', { variant: 'info' })}>
            <FolderPlus className="h-4 w-4" /> New Folder
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => toast('Custom brains land in a later phase — select a module pack below', { variant: 'info' })}>
            <Plus className="h-4 w-4" /> New Brain
          </Button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packs?.map((pack) => (
            <Card key={pack.key} className="cursor-pointer space-y-2 transition-shadow hover:shadow-md" onClick={() => navigate(`/ai-suite/brain/${pack.key}`)}>
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <BrainCircuit className="h-4.5 w-4.5" />
                </div>
                {!pack.hasLiveData && <Badge>Later phase</Badge>}
              </div>
              <p className="font-medium">{pack.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {pack.docCount} doc{pack.docCount === 1 ? '' : 's'}
                {pack.unansweredCount > 0 && ` · ${pack.unansweredCount} unanswered`}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
