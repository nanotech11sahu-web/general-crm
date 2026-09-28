import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus } from 'lucide-react';
import { listFunnels, createFunnel } from '../../lib/api/funnels';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';

export function SitesListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  const { data: funnels, isLoading } = useQuery({ queryKey: ['funnels'], queryFn: listFunnels });

  const mutation = useMutation({
    mutationFn: () => createFunnel(name),
    onSuccess: (funnel) => {
      queryClient.invalidateQueries({ queryKey: ['funnels'] });
      setOpen(false);
      setName('');
      navigate(`/lead-generation/sites/${funnel._id}`);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sites</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Create
        </Button>
      </div>

      {isLoading && <SkeletonList rows={3} />}

      {!isLoading && funnels?.length === 0 && (
        <EmptyState icon={Globe} title="No sites yet" description="Create your first funnel to publish a page." actionLabel="Create Funnel" onAction={() => setOpen(true)} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {funnels?.map((funnel) => (
          <Card key={funnel._id} className="cursor-pointer" onClick={() => navigate(`/lead-generation/sites/${funnel._id}`)}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{funnel.name}</h3>
              <Badge tone={funnel.pages.some((p) => p.status === 'active') ? 'success' : 'neutral'}>
                {funnel.pages.some((p) => p.status === 'active') ? 'Live' : 'Draft'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{funnel.pages.length} page(s)</p>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Funnel"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </div>
  );
}
