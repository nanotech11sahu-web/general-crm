import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Video, Plus, Sparkles } from 'lucide-react';
import { getZoomStatus, connectZoom, listWebinars, createWebinar } from '../../lib/api/webinars';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function WebinarsTab() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: zoom } = useQuery({ queryKey: ['zoom-status'], queryFn: getZoomStatus });
  const { data: webinars, isLoading } = useQuery({ queryKey: ['webinars'], queryFn: () => listWebinars() });

  const connectMutation = useMutation({
    mutationFn: connectZoom,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['zoom-status'] });
      toast('Zoom connected', { variant: 'success' });
    },
  });

  return (
    <div className="space-y-4">
      {!zoom?.connected && (
        <Card className="flex flex-wrap items-center justify-between gap-2 border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5">
          <p className="text-sm">Zoom is not connected. Connect it to auto-generate join links for your webinars.</p>
          <Button size="sm" loading={connectMutation.isPending} onClick={() => connectMutation.mutate()}>
            Connect Zoom
          </Button>
        </Card>
      )}

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Webinar
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !webinars?.length ? (
        <EmptyState icon={Video} title="No webinars yet" description="Create a webinar to start collecting registrations." actionLabel="Create Webinar" onAction={() => setCreateOpen(true)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {webinars.map((w) => (
            <Card key={w._id} className="space-y-2">
              <div className="flex items-start justify-between">
                <p className="font-medium">{w.topic}</p>
                <Badge tone={w.status === 'scheduled' ? 'success' : w.status === 'cancelled' ? 'danger' : 'neutral'}>{w.status}</Badge>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">{new Date(w.startAt).toLocaleString()} · {w.durationMinutes} min</p>
            </Card>
          ))}
        </div>
      )}

      <CreateWebinarModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function CreateWebinarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [mode, setMode] = useState<'built_in' | 'site_funnel' | 'external'>('built_in');

  const createMutation = useMutation({
    mutationFn: () =>
      createWebinar({
        topic,
        description,
        startAt: new Date(startAt).toISOString(),
        durationMinutes,
        scheduleType: 'one_time',
        options: { requireRegistration: true, restrictToRegistered: true, enableRecording: true, enableQnA: true, enablePolls: false, enableChat: true, altHostEmails: [] },
        registration: { mode },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webinars'] });
      toast('Webinar created', { variant: 'success' });
      setTopic('');
      setDescription('');
      setStartAt('');
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create Webinar">
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-primary)]">
          <Sparkles className="h-3.5 w-3.5" /> AI-suggest topic & description (coming in a later phase)
        </div>
        <Input label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Description</span>
          <textarea className="min-h-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date & Time" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          <Input label="Duration (min)" type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(Number(e.target.value))} />
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Registration & Landing Page</legend>
          {(['built_in', 'site_funnel', 'external'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
              {m === 'built_in' ? 'Built-in Landing Page' : m === 'site_funnel' ? 'Site Funnel Page' : 'External URL'}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-[var(--color-text-muted)]">Merge tag available in confirmation messages: {'{{webinar_link_}}'}</p>
        <Button disabled={!topic || !startAt} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Create Webinar
        </Button>
      </div>
    </Modal>
  );
}
