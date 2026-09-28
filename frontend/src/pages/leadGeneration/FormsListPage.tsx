import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Sparkles } from 'lucide-react';
import { listForms, createForm, createFormWithAi } from '../../lib/api/forms';
import { toast } from '../../stores/toastStore';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';

export function FormsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [error, setError] = useState('');

  const { data: forms, isLoading } = useQuery({ queryKey: ['forms'], queryFn: listForms });

  const mutation = useMutation({
    mutationFn: () => createForm(name),
    onSuccess: (form) => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      setOpen(false);
      setName('');
      navigate(`/lead-generation/forms/${form._id}`);
    },
    onError: () => setError('Could not create form.'),
  });

  const aiMutation = useMutation({
    mutationFn: () => createFormWithAi(aiPrompt),
    onSuccess: (form) => {
      queryClient.invalidateQueries({ queryKey: ['forms'] });
      setOpen(false);
      setAiPrompt('');
      toast('Form generated', { variant: 'success' });
      navigate(`/lead-generation/forms/${form._id}`);
    },
    onError: () => toast('Could not reach the AI gateway (check the workspace wallet balance)', { variant: 'error' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Forms</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Create New Form
        </Button>
      </div>

      {isLoading && <SkeletonList rows={3} />}

      {!isLoading && forms?.length === 0 && (
        <EmptyState icon={FileText} title="No forms found" description="Create your first form to start capturing leads." actionLabel="Create New Form" onAction={() => setOpen(true)} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {forms?.map((form) => (
          <Card key={form._id} className="cursor-pointer" onClick={() => navigate(`/lead-generation/forms/${form._id}`)}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{form.name}</h3>
              <Badge tone={form.status === 'published' ? 'success' : 'neutral'}>{form.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">/{form.slug}</p>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create New Form"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Start from Scratch
            </Button>
          </>
        }
      >
        <Input label="Form Name" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">Creates a blank form with Name/Email fields. Templates land in a later phase.</p>

        <div className="my-4 border-t border-[var(--color-border)] pt-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-[var(--color-primary)]" /> Or generate with AI
          </p>
          <div className="flex gap-2">
            <Input aria-label="Describe the form you want" placeholder="e.g. Book a demo call" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="flex-1" />
            <Button disabled={!aiPrompt.trim()} loading={aiMutation.isPending} onClick={() => aiMutation.mutate()}>
              Generate
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
