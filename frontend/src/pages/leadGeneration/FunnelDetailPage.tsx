import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, ExternalLink, Copy, Rocket } from 'lucide-react';
import clsx from 'clsx';
import { getFunnel, updatePage, publishPage, updateFunnel } from '../../lib/api/funnels';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { BlockType, FunnelBlock } from '../../types/leadgen';

const TABS = ['Pages', 'Analytics', 'Tracking', 'Settings'] as const;
type Tab = (typeof TABS)[number];

export function FunnelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('Pages');

  const { data: funnel, isLoading } = useQuery({ queryKey: ['funnel', id], queryFn: () => getFunnel(id!), enabled: Boolean(id) });

  if (isLoading) return <SkeletonList rows={5} />;
  if (!funnel) return null;

  const homePage = funnel.pages.find((p) => p.isHome) ?? funnel.pages[0];
  const publicUrl = `${window.location.origin}/s/${funnel.publicId}${homePage.path === '/' ? '' : homePage.path}`;

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{funnel.name}</h1>
        <div className="flex items-center gap-2">
          <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-muted)] px-2 py-1 text-xs">{publicUrl}</code>
          <button
            type="button"
            aria-label="Copy public URL"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              toast('Link copied', { variant: 'success' });
            }}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <Copy className="h-4 w-4" />
          </button>
          <a href={`/s/${funnel.publicId}${homePage.path === '/' ? '' : homePage.path}`} target="_blank" rel="noreferrer" aria-label="Open public page">
            <ExternalLink className="h-4 w-4 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" />
          </a>
        </div>
      </div>

      <nav className="flex gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'Pages' && <PageEditor funnelId={funnel._id} page={homePage} />}
      {tab === 'Analytics' && (
        <Card>
          <p className="text-sm text-[var(--color-text-muted)]">Waiting for instrumentation — analytics populate once this page starts receiving real visits.</p>
        </Card>
      )}
      {tab === 'Tracking' && (
        <TrackingTab
          funnelId={funnel._id}
          trackingHeader={funnel.settings.trackingHeader}
          trackingBody={funnel.settings.trackingBody}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['funnel', id] })}
        />
      )}
      {tab === 'Settings' && <SettingsTab funnelId={funnel._id} name={funnel.name} onSaved={() => queryClient.invalidateQueries({ queryKey: ['funnel', id] })} />}
    </div>
  );
}

const BLOCK_TYPES: BlockType[] = ['heading', 'text', 'image', 'cta', 'divider'];

function PageEditor({ funnelId, page }: { funnelId: string; page: { id: string; blocks: FunnelBlock[]; status: string } }) {
  const queryClient = useQueryClient();
  const [blocks, setBlocks] = useState<FunnelBlock[]>(page.blocks);

  const saveMutation = useMutation({
    mutationFn: () => updatePage(funnelId, page.id, blocks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funnel', funnelId] });
      toast('Page saved', { variant: 'success' });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishPage(funnelId, page.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['funnel', funnelId] });
      toast('Page published', { variant: 'success', description: 'It is now live at its public URL.' });
    },
    onError: () => toast('Could not publish', { variant: 'error', description: 'Add at least one block first.' }),
  });

  function addBlock(type: BlockType) {
    setBlocks((prev) => [...prev, { id: `tmp-${Date.now()}`, type, content: type === 'cta' ? 'Click here' : 'New block text' }]);
  }

  function removeBlock(id: string) {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function updateBlockContent(id: string, content: string) {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, content } : b)));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="space-y-2 lg:col-span-1">
        <h3 className="font-semibold">Elements</h3>
        {BLOCK_TYPES.map((type) => (
          <Button key={type} variant="secondary" size="sm" className="w-full justify-start gap-1.5" onClick={() => addBlock(type)}>
            <Plus className="h-4 w-4" /> {type[0].toUpperCase() + type.slice(1)}
          </Button>
        ))}
      </Card>

      <Card className="space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Page content</h3>
          <Badge tone={page.status === 'active' ? 'success' : 'neutral'}>{page.status === 'active' ? 'Published' : 'Draft'}</Badge>
        </div>

        {blocks.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">Add elements from the left to build this page.</p>}

        <div className="space-y-2">
          {blocks.map((block) => (
            <div key={block.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
              <Badge>{block.type}</Badge>
              <Input aria-label={`${block.type} content`} value={block.content} onChange={(e) => updateBlockContent(block.id, e.target.value)} className="flex-1" />
              <button type="button" aria-label="Remove block" onClick={() => removeBlock(block.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="secondary" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            Save
          </Button>
          <Button className="gap-1.5" loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
            <Rocket className="h-4 w-4" /> Publish
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TrackingTab({
  funnelId,
  trackingHeader,
  trackingBody,
  onSaved,
}: {
  funnelId: string;
  trackingHeader?: string;
  trackingBody?: string;
  onSaved: () => void;
}) {
  const [header, setHeader] = useState(trackingHeader ?? '');
  const [body, setBody] = useState(trackingBody ?? '');
  const mutation = useMutation({
    mutationFn: () => updateFunnel(funnelId, { settings: { trackingHeader: header, trackingBody: body } }),
    onSuccess: () => {
      onSaved();
      toast('Tracking code saved', { variant: 'success' });
    },
  });
  return (
    <Card className="space-y-3">
      <Input label="Header tracking code" value={header} onChange={(e) => setHeader(e.target.value)} />
      <Input label="Body tracking code" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Save
      </Button>
    </Card>
  );
}

function SettingsTab({ funnelId, name, onSaved }: { funnelId: string; name: string; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const mutation = useMutation({
    mutationFn: () => updateFunnel(funnelId, { name: value }),
    onSuccess: () => {
      onSaved();
      toast('Settings saved', { variant: 'success' });
    },
  });
  return (
    <Card className="space-y-3">
      <Input label="Funnel name" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
        Update
      </Button>
    </Card>
  );
}
