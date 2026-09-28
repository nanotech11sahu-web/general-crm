import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Link2, Plus, AlertTriangle } from 'lucide-react';
import { listDomains, createDomain, listLinks, createLink, getUrlsDashboard } from '../../lib/api/urls';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Dashboard', 'Links'] as const;
type Tab = (typeof TABS)[number];

export function UrlsPage() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">URLs</h1>
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
      {tab === 'Dashboard' && <DashboardTab />}
      {tab === 'Links' && <LinksTab />}
    </div>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['urls-dashboard'], queryFn: getUrlsDashboard });
  if (isLoading) return <SkeletonList rows={3} />;
  if (!data) return null;
  const kpis = [
    { label: 'Total Links', value: data.kpis.totalLinks },
    { label: 'Total Clicks', value: data.kpis.totalClicks },
    { label: 'Unique Clicks', value: data.kpis.uniqueClicks },
    { label: 'Domains', value: data.kpis.domains },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((k) => (
        <Card key={k.label}>
          <p className="text-sm text-[var(--color-text-muted)]">{k.label}</p>
          <p className="mt-1 text-xl font-semibold">{k.value}</p>
        </Card>
      ))}
    </div>
  );
}

function LinksTab() {
  const queryClient = useQueryClient();
  const [domainModalOpen, setDomainModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [linkForm, setLinkForm] = useState({ destinationUrl: '', title: '', domainId: '', utmSource: '' });

  const { data: linksData, isLoading } = useQuery({ queryKey: ['urls-links'], queryFn: listLinks });
  const { data: domains } = useQuery({ queryKey: ['urls-domains'], queryFn: listDomains });

  const addDomainMutation = useMutation({
    mutationFn: () => createDomain(hostname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['urls-domains'] });
      queryClient.invalidateQueries({ queryKey: ['urls-links'] });
      toast('Domain added', { variant: 'success', description: hostname });
      setDomainModalOpen(false);
      setHostname('');
    },
  });

  const createLinkMutation = useMutation({
    mutationFn: () =>
      createLink({
        destinationUrl: linkForm.destinationUrl,
        domainId: linkForm.domainId,
        title: linkForm.title || undefined,
        utm: linkForm.utmSource ? { source: linkForm.utmSource } : undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['urls-links'] });
      toast('Link created', { variant: 'success', description: res.publicUrl });
      setLinkModalOpen(false);
      setLinkForm({ destinationUrl: '', title: '', domainId: '', utmSource: '' });
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  const hasDomain = linksData?.hasDomain ?? false;

  return (
    <div className="space-y-4">
      {!hasDomain && (
        <Card className="flex flex-wrap items-center gap-3 border-l-4 border-l-[var(--color-warning)]">
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" />
          <div className="flex-1">
            <p className="text-sm font-medium">No domain connected</p>
            <p className="text-sm text-[var(--color-text-muted)]">Add a domain before you can create links.</p>
          </div>
          <Button size="sm" onClick={() => setDomainModalOpen(true)}>
            Add Domain
          </Button>
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          className="gap-1.5"
          disabled={!hasDomain}
          title={!hasDomain ? 'Add a domain first' : undefined}
          onClick={() => {
            setLinkForm((f) => ({ ...f, domainId: domains?.[0]?._id ?? '' }));
            setLinkModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Create Link
        </Button>
      </div>

      {linksData?.links.length === 0 && <EmptyState icon={Link2} title="No links yet" description="Create your first short link once a domain is connected." />}

      <div className="space-y-2">
        {linksData?.links.map((link) => (
          <Card key={link._id} className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{link.title || link.slug}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{link.destinationUrl}</p>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">{link.clicks} clicks</p>
          </Card>
        ))}
      </div>

      <Modal
        open={domainModalOpen}
        onClose={() => setDomainModalOpen(false)}
        title="Add Domain"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDomainModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!hostname} loading={addDomainMutation.isPending} onClick={() => addDomainMutation.mutate()}>
              Add Domain
            </Button>
          </>
        }
      >
        <Input label="Domain" placeholder="pmc.link" required value={hostname} onChange={(e) => setHostname(e.target.value)} />
      </Modal>

      <Modal
        open={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Create Link"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinkModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!linkForm.destinationUrl || !linkForm.domainId} loading={createLinkMutation.isPending} onClick={() => createLinkMutation.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">Domain</span>
            <select
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
              value={linkForm.domainId}
              onChange={(e) => setLinkForm({ ...linkForm, domainId: e.target.value })}
            >
              {domains?.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.hostname}
                </option>
              ))}
            </select>
          </label>
          <Input label="Destination URL" required value={linkForm.destinationUrl} onChange={(e) => setLinkForm({ ...linkForm, destinationUrl: e.target.value })} />
          <Input label="Title" value={linkForm.title} onChange={(e) => setLinkForm({ ...linkForm, title: e.target.value })} />
          <Input label="UTM Source" value={linkForm.utmSource} onChange={(e) => setLinkForm({ ...linkForm, utmSource: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
