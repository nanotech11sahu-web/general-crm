import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationsTab } from './ConversationsTab';

vi.mock('../../lib/api/inbox', () => ({
  listConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  replyToConversation: vi.fn(),
  starConversation: vi.fn(),
}));

import { listConversations, getConversationMessages } from '../../lib/api/inbox';

const CONVERSATION = {
  contactId: 'c1',
  contactName: 'Jamie Booker',
  lastMessage: { channel: 'chatWidget' as const, direction: 'inbound' as const, content: 'Hi there', createdAt: new Date().toISOString() },
  messageCount: 3,
  unread: true,
  starred: false,
  isNew: true,
};

const MESSAGES = [
  { channel: 'whatsapp' as const, direction: 'outbound' as const, content: 'Welcome!', createdAt: new Date().toISOString() },
  { channel: 'email' as const, direction: 'outbound' as const, content: 'Welcome aboard', createdAt: new Date().toISOString() },
  { channel: 'chatWidget' as const, direction: 'inbound' as const, content: 'Hi there', createdAt: new Date().toISOString() },
];

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationsTab />
    </QueryClientProvider>,
  );
}

describe('ConversationsTab — omnichannel merge (Phase 9 core DoD)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listConversations as ReturnType<typeof vi.fn>).mockResolvedValue([CONVERSATION]);
    (getConversationMessages as ReturnType<typeof vi.fn>).mockResolvedValue(MESSAGES);
  });

  it('lists conversations and shows a merged WhatsApp + Email + Chat Widget thread when selected', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('Jamie Booker')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Jamie Booker'));

    await waitFor(() => expect(screen.getByText('Welcome!')).toBeInTheDocument());
    expect(screen.getByText('Welcome aboard')).toBeInTheDocument();
    expect(screen.getAllByText('Hi there').length).toBeGreaterThan(0);
  });
});
