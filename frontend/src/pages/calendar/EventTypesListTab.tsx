import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Plus, Copy, Trash2, CalendarDays } from 'lucide-react';
import clsx from 'clsx';
import { listEventTypes, createEventType, deleteEventType, unpublishEventType, publishEventType } from '../../lib/api/eventTypes';
import { listTemplates } from '../../lib/api/eventTypes';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

export function EventTypesListTab() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [galleryOpen, setGalleryOpen] = useState(false);

  const { data: eventTypes, isLoading } = useQuery({ queryKey: ['event-types'], queryFn: listEventTypes });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEventType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-types'] });
      toast('Moved to Recover bin', { variant: 'success' });
    },
  });

  const togglePublishMutation = useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => (publish ? publishEventType(id) : unpublishEventType(id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-types'] }),
    onError: () => toast('Fix the wizard issues before publishing', { variant: 'error' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">Booking-link domain note: pages publish to your workspace's default booking domain.</p>
        <Button size="sm" className="gap-1.5" onClick={() => setGalleryOpen(true)}>
          <Plus className="h-4 w-4" /> Create Calendar
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !eventTypes?.length ? (
        <EmptyState icon={CalendarDays} title="No calendars yet" description="Create your first calendar from a template or start from scratch." actionLabel="Create Calendar" onAction={() => setGalleryOpen(true)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {eventTypes.map((et) => (
            <Card key={et._id} className="space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{et.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {et.durationMinutes} min · {et.locationType.replace('_', ' ')}
                  </p>
                </div>
                <Badge tone={et.status === 'published' ? 'success' : 'neutral'}>{et.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => navigate(`/calendar/event-types/${et._id}`)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={togglePublishMutation.isPending}
                  onClick={() => togglePublishMutation.mutate({ id: et._id, publish: et.status === 'draft' })}
                >
                  {et.status === 'draft' ? 'Publish' : 'Unpublish'}
                </Button>
                {et.status === 'published' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Copy booking link"
                    className="gap-1"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${window.location.origin}/book/${et.publicId}`);
                      toast('Booking link copied', { variant: 'success' });
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" /> Link
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label="Delete calendar" onClick={() => deleteMutation.mutate(et._id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <TemplateGalleryModal open={galleryOpen} onClose={() => setGalleryOpen(false)} />
    </div>
  );
}

function TemplateGalleryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('All');
  const { data } = useQuery({ queryKey: ['calendar-templates'], queryFn: listTemplates, enabled: open });

  const categories = useMemo(() => ['All', ...(data?.categories ?? [])], [data]);
  const templates = useMemo(
    () => (data?.templates ?? []).filter((t) => category === 'All' || t.category === category),
    [data, category],
  );

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; templateKey: string }) => createEventType(payload),
    onSuccess: (eventType) => {
      queryClient.invalidateQueries({ queryKey: ['event-types'] });
      onClose();
      navigate(`/calendar/event-types/${eventType._id}`);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Create Calendar">
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-[var(--color-primary)]">
          <Sparkles className="h-4 w-4" /> Generate with AI (coming in a later phase)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-xs font-medium',
                category === c ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate({ name: t.name, templateKey: t.key })}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{t.name}</p>
                <Badge>{t.badge}</Badge>
              </div>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t.durationMinutes} min · {t.serviceCount} service{t.serviceCount > 1 ? 's' : ''}
              </p>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
