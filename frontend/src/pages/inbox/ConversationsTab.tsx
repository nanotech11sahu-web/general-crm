import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Star, Send, MessageSquare, Mail, MessageCircle } from 'lucide-react';
import { listConversations, getConversationMessages, replyToConversation, starConversation } from '../../lib/api/inbox';
import type { InboxFilter, InboxChannel } from '../../types/inbox';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';

const FILTERS: InboxFilter[] = ['new', 'all', 'unread', 'starred', 'snoozed'];

const CHANNEL_ICON: Record<InboxChannel, typeof Mail> = { whatsapp: MessageCircle, email: Mail, chatWidget: MessageSquare };
const CHANNEL_LABEL: Record<InboxChannel, string> = { whatsapp: 'WhatsApp', email: 'Email', chatWidget: 'Chat Widget' };

function ConversationThread({ contactId }: { contactId: string }) {
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<InboxChannel>('chatWidget');
  const [draft, setDraft] = useState('');
  const { data: messages, isLoading } = useQuery({ queryKey: ['inbox-messages', contactId], queryFn: () => getConversationMessages(contactId) });

  const replyMutation = useMutation({
    mutationFn: () => replyToConversation(contactId, channel, draft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-messages', contactId] });
      queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
      setDraft('');
    },
  });

  if (isLoading) return <SkeletonList rows={3} />;

  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex-1 space-y-2 overflow-y-auto">
        {(messages ?? []).map((m, i) => {
          const Icon = CHANNEL_ICON[m.channel];
          return (
            <div key={i} className={clsx('max-w-[80%] rounded-[var(--radius-md)] p-2 text-sm', m.direction === 'inbound' ? 'bg-[var(--color-surface-muted)]' : 'ml-auto bg-[var(--color-primary)]/10')}>
              <div className="mb-1 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <Icon className="h-3 w-3" /> {CHANNEL_LABEL[m.channel]} · {m.direction}
              </div>
              {m.content}
            </div>
          );
        })}
        {(messages ?? []).length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No messages yet.</p>}
      </div>
      <div className="flex gap-2">
        <select
          aria-label="Reply channel"
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
          value={channel}
          onChange={(e) => setChannel(e.target.value as InboxChannel)}
        >
          {(Object.keys(CHANNEL_LABEL) as InboxChannel[]).map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          aria-label="Reply message"
          className="h-10 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-[var(--color-primary)]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a reply…"
        />
        <Button size="sm" disabled={!draft} loading={replyMutation.isPending} onClick={() => replyMutation.mutate()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

export function ConversationsTab({ channelFilter }: { channelFilter?: InboxChannel } = {}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: rawConversations, isLoading } = useQuery({ queryKey: ['inbox-conversations', filter], queryFn: () => listConversations(filter) });
  const conversations = channelFilter ? rawConversations?.filter((c) => c.lastMessage.channel === channelFilter) : rawConversations;

  const starMutation = useMutation({
    mutationFn: ({ contactId, starred }: { contactId: string; starred: boolean }) => starConversation(contactId, starred),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] }),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <nav className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors',
                filter === f ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]',
              )}
            >
              {f}
            </button>
          ))}
        </nav>
        {isLoading ? (
          <SkeletonList rows={3} />
        ) : (conversations ?? []).length === 0 ? (
          <EmptyState icon={MessageSquare} title="No conversations" description="Nothing here yet." />
        ) : (
          <div className="space-y-2">
            {(conversations ?? []).map((c) => (
              <Card
                key={c.contactId}
                className={clsx('cursor-pointer space-y-1', selected === c.contactId && 'border-[var(--color-primary)]')}
                onClick={() => setSelected(c.contactId)}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">{c.contactName}</p>
                  <button
                    type="button"
                    aria-label="Star conversation"
                    onClick={(e) => {
                      e.stopPropagation();
                      starMutation.mutate({ contactId: c.contactId, starred: !c.starred });
                    }}
                  >
                    <Star className={clsx('h-4 w-4', c.starred ? 'fill-[var(--color-warning)] text-[var(--color-warning)]' : 'text-[var(--color-text-muted)]')} />
                  </button>
                </div>
                <p className="truncate text-xs text-[var(--color-text-muted)]">{c.lastMessage.content}</p>
                <div className="flex items-center gap-1.5">
                  <Badge tone="neutral">{CHANNEL_LABEL[c.lastMessage.channel]}</Badge>
                  {c.unread && <Badge tone="success">Unread</Badge>}
                  {c.isNew && <Badge tone="warning">New</Badge>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-[400px]">{selected ? <ConversationThread contactId={selected} /> : <EmptyState icon={MessageSquare} title="Select a conversation" description="Pick a conversation on the left to view its thread." />}</div>
    </div>
  );
}
