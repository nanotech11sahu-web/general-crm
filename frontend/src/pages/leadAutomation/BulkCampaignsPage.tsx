import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Megaphone, Plus } from 'lucide-react';
import { listBulkCampaigns, createBulkCampaign, sendBulkCampaign } from '../../lib/api/bulkCampaigns';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const STATUS_TABS = ['All', 'Draft', 'Scheduled', 'Running', 'Completed'] as const;

export function BulkCampaignsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>('All');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', channels: [] as string[], emailSubject: '', message: '' });

  const { data: campaigns, isLoading } = useQuery({ queryKey: ['bulk-campaigns', status], queryFn: () => listBulkCampaigns(status) });

  const createMutation = useMutation({
    mutationFn: () => createBulkCampaign(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-campaigns'] });
      toast('Campaign created', { variant: 'success' });
      setOpen(false);
      setForm({ name: '', channels: [], emailSubject: '', message: '' });
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => sendBulkCampaign(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bulk-campaigns'] });
      toast('Campaign sent', { variant: 'success' });
    },
  });

  function toggleChannel(channel: string) {
    setForm((f) => ({ ...f, channels: f.channels.includes(channel) ? f.channels.filter((c) => c !== channel) : [...f.channels, channel] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Bulk Campaigns</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Create Campaign
        </Button>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-border)]">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              status === s ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading && <SkeletonList rows={3} />}
      {!isLoading && campaigns?.length === 0 && <EmptyState icon={Megaphone} title="No campaigns found" description="Create a multi-channel campaign to reach your contacts." />}

      <div className="space-y-2">
        {campaigns?.map((c) => (
          <Card key={c._id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{c.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                {c.channels.join(' + ')} · {c.recipientCount} recipients
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={c.status === 'completed' ? 'success' : 'neutral'}>{c.status}</Badge>
              {c.status !== 'completed' && (
                <Button size="sm" variant="secondary" loading={sendMutation.isPending} onClick={() => sendMutation.mutate(c._id)}>
                  Send Now
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Campaign"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!form.name || form.channels.length === 0} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="flex gap-2">
            {['email', 'whatsapp'].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => toggleChannel(ch)}
                className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-sm capitalize ${
                  form.channels.includes(ch) ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)]'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
          {form.channels.includes('email') && <Input label="Email Subject" value={form.emailSubject} onChange={(e) => setForm({ ...form, emailSubject: e.target.value })} />}
          {form.channels.includes('whatsapp') && <Input label="WhatsApp Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />}
        </div>
      </Modal>
    </div>
  );
}
