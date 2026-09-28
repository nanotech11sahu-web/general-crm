import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getInboxDashboard, listCannedReplies, createCannedReply } from '../../lib/api/inbox';
import { ConversationsTab } from './ConversationsTab';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { SkeletonList } from '../../components/ui/Skeleton';

const TABS = ['Conversations', 'Dashboard', 'Ecom Chat Widget', 'Settings'] as const;
type Tab = (typeof TABS)[number];

function DashboardTab() {
  const { data, isLoading } = useQuery({ queryKey: ['inbox-dashboard'], queryFn: getInboxDashboard });
  if (isLoading || !data) return <SkeletonList rows={2} />;
  const tiles = [
    ['Total Conversations', data.kpis.totalConversations],
    ['Unread', data.kpis.unread],
    ['Starred', data.kpis.starred],
    ['Snoozed', data.kpis.snoozed],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([label, value]) => (
        <Card key={label} className="text-center">
          <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </Card>
      ))}
    </div>
  );
}

function SettingsTab() {
  const queryClient = useQueryClient();
  const { data: cannedReplies, isLoading } = useQuery({ queryKey: ['canned-replies'], queryFn: listCannedReplies });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const createMutation = useMutation({
    mutationFn: () => createCannedReply({ title, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canned-replies'] });
      setTitle('');
      setBody('');
    },
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h4 className="font-semibold">Canned Replies</h4>
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input label="Body" value={body} onChange={(e) => setBody(e.target.value)} />
          <Button size="sm" disabled={!title || !body} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {isLoading ? (
          <SkeletonList rows={2} />
        ) : (
          <ul className="space-y-1 text-sm">
            {(cannedReplies ?? []).map((r) => (
              <li key={r._id}>
                <span className="font-medium">{r.title}:</span> {r.body}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="text-sm text-[var(--color-text-muted)]">SLAs and assignment rules ship in a later phase.</Card>
    </div>
  );
}

export function InboxHome() {
  const [tab, setTab] = useState<Tab>('Conversations');
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Inbox</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]" aria-label="Inbox tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {t}
          </button>
        ))}
      </nav>
      {tab === 'Conversations' && <ConversationsTab />}
      {tab === 'Dashboard' && <DashboardTab />}
      {tab === 'Ecom Chat Widget' && <ConversationsTab channelFilter="chatWidget" />}
      {tab === 'Settings' && <SettingsTab />}
    </div>
  );
}
