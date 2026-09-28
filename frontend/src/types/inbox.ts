export type InboxChannel = 'whatsapp' | 'email' | 'chatWidget';
export type InboxFilter = 'new' | 'all' | 'unread' | 'starred' | 'snoozed';

export interface InboxMessage {
  channel: InboxChannel;
  direction: 'inbound' | 'outbound';
  content: string;
  createdAt: string;
}

export interface InboxConversation {
  contactId: string;
  contactName: string;
  lastMessage: InboxMessage;
  messageCount: number;
  unread: boolean;
  starred: boolean;
  snoozedUntil?: string;
  isNew: boolean;
}

export interface InboxDashboard {
  kpis: {
    totalConversations: number;
    unread: number;
    starred: number;
    snoozed: number;
  };
}

export interface CannedReply {
  _id: string;
  title: string;
  body: string;
}
