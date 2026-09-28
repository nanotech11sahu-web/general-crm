import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Mail, Plus, Send, Sparkles } from 'lucide-react';
import { getEmailDashboard, createEmailCampaign, sendEmailCampaignNow, generateAiEmailCompose } from '../../lib/api/emailMarketing';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';

const TABS = ['Dashboard', 'Compose', 'Segments', 'Templates', 'SMTP'] as const;
type Tab = (typeof TABS)[number];

export function EmailMarketingPage() {
  const [tab, setTab] = useState<Tab>('Dashboard');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Email Marketing</h1>
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
      {tab === 'Compose' && <ComposeTab />}
      {tab === 'Segments' && <PlaceholderCard label="Segments" />}
      {tab === 'Templates' && <PlaceholderCard label="Templates" />}
      {tab === 'SMTP' && <PlaceholderCard label="Bring-your-own SMTP configuration" />}
    </div>
  );
}

function PlaceholderCard({ label }: { label: string }) {
  return (
    <Card>
      <p className="text-sm text-[var(--color-text-muted)]">{label} lands in a later pass — the sending pipeline is already real (see Compose).</p>
    </Card>
  );
}

function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['email-dashboard'], queryFn: getEmailDashboard });
  if (isLoading) return <SkeletonList rows={4} />;
  if (!data) return null;

  const kpis = [
    { label: 'Total Campaigns', value: data.kpis.totalCampaigns },
    { label: 'Total Sent', value: data.kpis.totalSent },
    { label: 'Delivered', value: data.kpis.delivered },
    { label: 'Avg Open Rate', value: `${data.kpis.avgOpenRate}%` },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-sm text-[var(--color-text-muted)]">{k.label}</p>
            <p className="mt-1 text-xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>
      {data.campaigns.length === 0 ? (
        <EmptyState icon={Mail} title="No campaigns yet" description="Compose your first email campaign to see activity here." />
      ) : (
        <div className="space-y-2">
          {data.campaigns.map((c) => (
            <Card key={c._id} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{c.subject}</p>
              </div>
              <Badge tone={c.status === 'sent' ? 'success' : 'neutral'}>{c.status}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeTab() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', subject: '', fromName: '', fromEmail: '', bodyPreview: '' });
  const [aiPrompt, setAiPrompt] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createEmailCampaign(form),
    onSuccess: (campaign) => {
      setCampaignId(campaign._id);
      toast('Draft campaign saved', { variant: 'success' });
    },
  });

  const aiComposeMutation = useMutation({
    mutationFn: () => generateAiEmailCompose(aiPrompt),
    onSuccess: (suggestion) => {
      setForm((f) => ({ ...f, subject: suggestion.subject, bodyPreview: suggestion.bodyPreview }));
      toast('Draft generated — review and adjust below', { variant: 'success' });
    },
    onError: () => toast('Could not reach the AI gateway (check the workspace wallet balance)', { variant: 'error' }),
  });

  const sendMutation = useMutation({
    mutationFn: () => sendEmailCampaignNow(campaignId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['email-dashboard'] });
      toast('Campaign sent', { variant: 'success', description: `${res.sent} sent, ${res.suppressed} suppressed` });
      setConfirmOpen(false);
      setCampaignId(null);
      setForm({ name: '', subject: '', fromName: '', fromEmail: '', bodyPreview: '' });
    },
  });

  return (
    <Card className="max-w-xl space-y-3">
      <div className="space-y-2 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-[var(--color-primary)]" /> AI-assisted compose
        </p>
        <div className="flex gap-2">
          <Input aria-label="Describe the email you want" placeholder="e.g. our autumn sale" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} className="flex-1" />
          <Button size="sm" disabled={!aiPrompt.trim()} loading={aiComposeMutation.isPending} onClick={() => aiComposeMutation.mutate()}>
            Draft
          </Button>
        </div>
      </div>
      <Input label="Campaign Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input label="Subject Line" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Body Preview</span>
        <textarea
          className="min-h-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
          value={form.bodyPreview}
          onChange={(e) => setForm({ ...form, bodyPreview: e.target.value })}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Input label="From Name" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
        <Input label="From Email" value={form.fromEmail} onChange={(e) => setForm({ ...form, fromEmail: e.target.value })} />
      </div>
      <div className="flex gap-2 pt-2">
        <Button variant="secondary" disabled={!form.name || !form.subject} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
          Save Draft
        </Button>
        <Button className="gap-1.5" disabled={!campaignId} onClick={() => setConfirmOpen(true)}>
          <Send className="h-4 w-4" /> Send Now
        </Button>
      </div>
      {!campaignId && <p className="text-xs text-[var(--color-text-muted)]">Save the draft first, then Send Now becomes available.</p>}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Send campaign now?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button loading={sendMutation.isPending} onClick={() => sendMutation.mutate()} className="gap-1.5">
              <Plus className="h-4 w-4" /> Confirm Send
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--color-text-muted)]">This sends to every active contact in this workspace, respecting DND and opt-outs.</p>
      </Modal>
    </Card>
  );
}
