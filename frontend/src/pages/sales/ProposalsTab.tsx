import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { listProposals, getProposalKpis, createProposal, transitionProposal, approveProposal } from '../../lib/api/proposals';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { ProposalDoc, ProposalStatus } from '../../types/sales';

const FUNNEL_STEPS: ProposalStatus[] = ['Built', 'Published', 'Sent', 'Viewed', 'Approved', 'Declined', 'Converted'];

const STATUS_TONE: Record<ProposalStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  Built: 'neutral',
  Published: 'neutral',
  Sent: 'warning',
  Viewed: 'warning',
  Approved: 'success',
  Declined: 'danger',
  Converted: 'success',
};

const NEXT_ACTION: Partial<Record<ProposalStatus, { label: string; action: 'publish' | 'send' | 'view' }>> = {
  Built: { label: 'Publish', action: 'publish' },
  Published: { label: 'Send', action: 'send' },
  Sent: { label: 'Mark Viewed', action: 'view' },
};

export function ProposalsTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: kpis } = useQuery({ queryKey: ['proposal-kpis'], queryFn: getProposalKpis });
  const { data: proposals, isLoading } = useQuery({ queryKey: ['proposals'], queryFn: () => listProposals() });

  const transitionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'publish' | 'send' | 'view' | 'decline' | 'convert' }) => transitionProposal(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal-kpis'] });
    },
    onError: () => toast('That transition is not allowed from the current status', { variant: 'error' }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, signatureName }: { id: string; signatureName: string }) => approveProposal(id, signatureName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal-kpis'] });
      toast('Proposal approved', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-7">
        {FUNNEL_STEPS.map((step) => (
          <Card key={step} className="p-2 text-center">
            <p className="text-lg font-semibold">{kpis?.funnel[step] ?? 0}</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">{step}</p>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-sm text-[var(--color-text-muted)]">Pipeline Value</p>
          <p className="text-xl font-semibold">₹{(kpis?.pipelineValue ?? 0).toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--color-text-muted)]">Won Value</p>
          <p className="text-xl font-semibold">₹{(kpis?.wonValue ?? 0).toLocaleString()}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--color-text-muted)]">Win Rate</p>
          <p className="text-xl font-semibold">{Math.round((kpis?.winRate ?? 0) * 100)}%</p>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New Proposal
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !proposals?.length ? (
        <EmptyState icon={FileText} title="No proposals yet" actionLabel="New Proposal" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="space-y-2">
          {proposals.map((p) => (
            <ProposalRow
              key={p._id}
              proposal={p}
              onTransition={(action) => transitionMutation.mutate({ id: p._id, action })}
              onApprove={(signatureName) => approveMutation.mutate({ id: p._id, signatureName })}
            />
          ))}
        </div>
      )}

      <CreateProposalModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function ProposalRow({
  proposal,
  onTransition,
  onApprove,
}: {
  proposal: ProposalDoc;
  onTransition: (action: 'publish' | 'send' | 'view' | 'decline' | 'convert') => void;
  onApprove: (signatureName: string) => void;
}) {
  const [signing, setSigning] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const next = NEXT_ACTION[proposal.status];

  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{proposal.name}</p>
          <p className="text-xs text-[var(--color-text-muted)]">₹{proposal.value.toLocaleString()}</p>
        </div>
        <Badge tone={STATUS_TONE[proposal.status]}>{proposal.status}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {next && (
          <Button size="sm" variant="secondary" onClick={() => onTransition(next.action)}>
            {next.label}
          </Button>
        )}
        {['Sent', 'Viewed'].includes(proposal.status) && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setSigning(true)}>
              Approve (e-sign)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onTransition('decline')}>
              Decline
            </Button>
          </>
        )}
        {proposal.status === 'Approved' && (
          <Button size="sm" onClick={() => onTransition('convert')}>
            Convert
          </Button>
        )}
      </div>
      {signing && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
          <Input aria-label="Signature name" placeholder="Type your full name to sign" value={signatureName} onChange={(e) => setSignatureName(e.target.value)} />
          <Button
            size="sm"
            disabled={!signatureName}
            onClick={() => {
              onApprove(signatureName);
              setSigning(false);
              setSignatureName('');
            }}
          >
            Confirm Signature
          </Button>
        </div>
      )}
    </Card>
  );
}

function CreateProposalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [value, setValue] = useState(0);

  const createMutation = useMutation({
    mutationFn: () => createProposal({ name, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal-kpis'] });
      setName('');
      setValue(0);
      onClose();
      toast('Proposal created', { variant: 'success' });
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New Proposal">
      <div className="space-y-3">
        <Input label="Proposal Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Value" type="number" min={0} value={value} onChange={(e) => setValue(Number(e.target.value))} />
        <Button disabled={!name} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Create
        </Button>
      </div>
    </Modal>
  );
}
