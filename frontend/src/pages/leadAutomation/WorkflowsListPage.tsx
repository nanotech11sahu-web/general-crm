import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Workflow as WorkflowIcon, Plus } from 'lucide-react';
import { listWorkflows, listTriggers, createWorkflow } from '../../lib/api/workflows';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';

export function WorkflowsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [triggerKey, setTriggerKey] = useState('');

  const { data: workflows, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: listWorkflows });
  const { data: triggers } = useQuery({ queryKey: ['triggers'], queryFn: listTriggers });

  const mutation = useMutation({
    mutationFn: () => createWorkflow(name, triggerKey),
    onSuccess: (workflow) => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      setOpen(false);
      setName('');
      setTriggerKey('');
      navigate(`/lead-automation/workflows/${workflow._id}`);
    },
  });

  const wiredTriggers = triggers?.filter((t) => t.wired) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Workflows</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New Workflow
        </Button>
      </div>

      {isLoading && <SkeletonList rows={3} />}
      {!isLoading && workflows?.length === 0 && (
        <EmptyState icon={WorkflowIcon} title="No workflows yet" description="Build your first automation, triggered by a real platform event." actionLabel="New Workflow" onAction={() => setOpen(true)} />
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workflows?.map((wf) => (
          <Card key={wf._id} className="cursor-pointer" onClick={() => navigate(`/lead-automation/workflows/${wf._id}`)}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{wf.name}</h3>
              <Badge tone={wf.status === 'published' ? 'success' : 'neutral'}>{wf.status}</Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Trigger: {wf.triggerKey}</p>
            <p className="text-xs text-[var(--color-text-muted)]">v{wf.version}</p>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Workflow"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!name || !triggerKey} loading={mutation.isPending} onClick={() => mutation.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-[var(--color-text-muted)]">Trigger</span>
            <select
              className="h-8 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              value={triggerKey}
              onChange={(e) => setTriggerKey(e.target.value)}
            >
              <option value="">Select a trigger…</option>
              {wiredTriggers.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-[var(--color-text-muted)]">
            {triggers ? triggers.length - wiredTriggers.length : 0} more triggers from the full taxonomy (Calendar, Finance, Community, Inbox) light up as those modules ship.
          </p>
        </div>
      </Modal>
    </div>
  );
}
