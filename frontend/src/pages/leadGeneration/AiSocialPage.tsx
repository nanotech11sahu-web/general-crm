import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Camera, Radio, Briefcase, AtSign } from 'lucide-react';
import { getSocialDashboard, connectSocialChannel, createSocialPost } from '../../lib/api/aiSocial';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { SocialChannelDoc } from '../../types/leadgen2';

const PLATFORM_ICONS = { instagram: Camera, facebook: Radio, linkedin: Briefcase, twitter: AtSign } as const;

export function AiSocialPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['social-dashboard'], queryFn: getSocialDashboard });

  const connectMutation = useMutation({
    mutationFn: (platform: SocialChannelDoc['platform']) => connectSocialChannel(platform),
    onSuccess: () => toast('Channel connected', { variant: 'success' }),
  });
  const queryClient = useQueryClient();

  if (isLoading) return <SkeletonList rows={4} />;
  if (!data) return null;

  const kpis = [
    { label: 'Reach', value: data.kpis.reach },
    { label: 'Engagement rate', value: `${data.kpis.engagementRate}%` },
    { label: 'Posts published', value: data.kpis.postsPublished },
    { label: 'Total audience', value: data.kpis.totalAudience },
  ];

  const allPlatforms: SocialChannelDoc['platform'][] = ['instagram', 'facebook', 'linkedin', 'twitter'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">AI Social</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Post
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-sm text-[var(--color-text-muted)]">{k.label}</p>
            <p className="mt-1 text-xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <h3 className="mb-3 font-semibold">Delivery Health Funnel</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.deliveryFunnel).map(([status, count]) => (
            <Badge key={status}>
              {status.replace('_', ' ')}: {count}
            </Badge>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Your Channels</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {allPlatforms.map((platform) => {
            const channel = data.channels.find((c) => c.platform === platform);
            const Icon = PLATFORM_ICONS[platform];
            const connected = channel?.status === 'connected';
            return (
              <div key={platform} className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                <Icon className="h-6 w-6 text-[var(--color-text-muted)]" />
                <span className="text-xs capitalize">{platform}</span>
                {connected ? (
                  <Badge tone="success">Connected</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={connectMutation.isPending}
                    onClick={() => connectMutation.mutate(platform, { onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social-dashboard'] }) })}
                  >
                    Connect
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <CreatePostModal open={createOpen} onClose={() => setCreateOpen(false)} channels={data.channels} />
    </div>
  );
}

function CreatePostModal({ open, onClose, channels }: { open: boolean; onClose: () => void; channels: SocialChannelDoc[] }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [content, setContent] = useState('');

  const mutation = useMutation({
    mutationFn: (mode: 'draft' | 'publish') => createSocialPost({ content, channels: selectedChannels, mode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['social-dashboard'] });
      toast('Post saved', { variant: 'success' });
      reset();
      onClose();
    },
    onError: () => toast('Could not publish — check that selected channels are connected', { variant: 'error' }),
  });

  function reset() {
    setStep(1);
    setSelectedChannels([]);
    setContent('');
  }

  function toggleChannel(platform: string) {
    setSelectedChannels((prev) => (prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]));
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`Create Post — Step ${step} of 3`}
    >
      <div className="space-y-4">
        {step === 1 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Select Channels</p>
            {channels.filter((c) => c.status === 'connected').length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">Connect a channel first from the dashboard.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {channels
                .filter((c) => c.status === 'connected')
                .map((c) => (
                  <button
                    key={c.platform}
                    type="button"
                    onClick={() => toggleChannel(c.platform)}
                    className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-sm ${
                      selectedChannels.includes(c.platform) ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' : 'border-[var(--color-border)]'
                    }`}
                  >
                    {c.platform}
                  </button>
                ))}
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Create Content</p>
            <textarea
              className="h-32 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What do you want to share?"
            />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Preview & Publish</p>
            <Card>
              <p className="text-xs text-[var(--color-text-muted)]">{selectedChannels.join(', ')}</p>
              <p className="mt-1 text-sm">{content}</p>
            </Card>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <Button variant="secondary" onClick={() => (step === 1 ? onClose() : setStep(step - 1))}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button disabled={step === 1 && selectedChannels.length === 0} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="secondary" loading={mutation.isPending} onClick={() => mutation.mutate('draft')}>
                Save Draft
              </Button>
              <Button loading={mutation.isPending} onClick={() => mutation.mutate('publish')}>
                Publish
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
