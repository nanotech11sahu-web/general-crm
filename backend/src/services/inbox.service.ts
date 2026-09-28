import { Types } from 'mongoose';
import { WhatsAppLog } from '../models/WhatsAppLog';
import { EmailLog } from '../models/EmailLog';
import { ChatWidgetMessage } from '../models/ChatWidgetMessage';
import { InboxConversationState } from '../models/InboxConversationState';
import { Contact } from '../models/Contact';
import { sendEmail, sendWhatsApp } from './messaging.service';
import { emitPlatformEvent } from '../lib/eventBus';
import { notifyWorkspaceOwner } from './notification.service';

export type InboxChannel = 'whatsapp' | 'email' | 'chatWidget';
export type InboxFilter = 'new' | 'all' | 'unread' | 'starred' | 'snoozed';

interface MergedMessage {
  channel: InboxChannel;
  direction: 'inbound' | 'outbound';
  content: string;
  status?: string;
  createdAt: Date;
}

async function fetchAllMessages(workspaceId: string): Promise<Map<string, MergedMessage[]>> {
  const [whatsapp, email, chatWidget] = await Promise.all([
    WhatsAppLog.find({ workspaceId }).lean(),
    EmailLog.find({ workspaceId }).lean(),
    ChatWidgetMessage.find({ workspaceId }).lean(),
  ]);

  const byContact = new Map<string, MergedMessage[]>();
  const push = (contactId: Types.ObjectId, msg: MergedMessage) => {
    const key = String(contactId);
    if (!byContact.has(key)) byContact.set(key, []);
    byContact.get(key)!.push(msg);
  };

  for (const w of whatsapp) {
    if (w.status !== 'sent') continue;
    push(w.contactId, { channel: 'whatsapp', direction: 'outbound', content: w.message, createdAt: w.createdAt });
  }
  for (const e of email) {
    if (e.status !== 'sent') continue;
    push(e.contactId, { channel: 'email', direction: 'outbound', content: e.subject, createdAt: e.createdAt });
  }
  for (const c of chatWidget) {
    push(c.contactId, { channel: 'chatWidget', direction: c.direction, content: c.message, createdAt: c.createdAt });
  }

  for (const messages of byContact.values()) {
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  return byContact;
}

export async function listConversations(workspaceId: string, filter: InboxFilter = 'all') {
  const [byContact, states, contacts] = await Promise.all([
    fetchAllMessages(workspaceId),
    InboxConversationState.find({ workspaceId }).lean(),
    Contact.find({ workspaceId }).lean(),
  ]);

  const stateByContact = new Map(states.map((s) => [String(s.contactId), s]));
  const contactById = new Map(contacts.map((c) => [String(c._id), c]));
  const now = new Date();

  const conversations = Array.from(byContact.entries())
    .map(([contactId, messages]) => {
      const last = messages[messages.length - 1];
      const state = stateByContact.get(contactId);
      const isUnread = !state?.lastReadAt || last.createdAt > state.lastReadAt;
      return {
        contactId,
        contactName: contactById.get(contactId)?.name ?? 'Unknown',
        lastMessage: last,
        messageCount: messages.length,
        unread: isUnread,
        starred: state?.starred ?? false,
        snoozedUntil: state?.snoozedUntil,
        isNew: !state,
      };
    })
    .sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());

  switch (filter) {
    case 'new':
      return conversations.filter((c) => c.isNew);
    case 'unread':
      return conversations.filter((c) => c.unread && !c.snoozedUntil);
    case 'starred':
      return conversations.filter((c) => c.starred);
    case 'snoozed':
      return conversations.filter((c) => c.snoozedUntil && c.snoozedUntil > now);
    default:
      return conversations;
  }
}

export async function getConversationMessages(workspaceId: string, contactId: string) {
  const byContact = await fetchAllMessages(workspaceId);
  const messages = byContact.get(contactId) ?? [];

  await InboxConversationState.findOneAndUpdate(
    { workspaceId, contactId },
    { $set: { lastReadAt: new Date() } },
    { upsert: true },
  );

  return messages;
}

export async function replyToConversation(workspaceId: string, contactId: string, channel: InboxChannel, message: string) {
  if (channel === 'whatsapp') {
    await sendWhatsApp(workspaceId, contactId, message, 'inbox');
  } else if (channel === 'email') {
    await sendEmail(workspaceId, contactId, message, 'inbox');
  } else {
    await ChatWidgetMessage.create({ workspaceId, contactId, direction: 'outbound', message });
  }
  return getConversationMessages(workspaceId, contactId);
}

export async function simulateInboundChatWidgetMessage(workspaceId: string, contactId: string, message: string) {
  const contact = await Contact.findOne({ _id: contactId, workspaceId });
  if (!contact) return null;

  const doc = await ChatWidgetMessage.create({ workspaceId, contactId, direction: 'inbound', message });

  // Only clears an existing conversation's read state back to unread — must not upsert,
  // since creating a state row here would make a brand-new conversation stop counting as "new".
  await InboxConversationState.updateOne({ workspaceId, contactId }, { $unset: { lastReadAt: '' } });

  emitPlatformEvent('inbox.messageReceived', { workspaceId, contactId, channel: 'chatWidget' });
  await notifyWorkspaceOwner(workspaceId, 'inbox.messageReceived', 'New inbox message', `New message from ${contact.name}`, '/inbox');
  return doc;
}

export async function setStarred(workspaceId: string, contactId: string, starred: boolean) {
  return InboxConversationState.findOneAndUpdate({ workspaceId, contactId }, { $set: { starred } }, { upsert: true, new: true });
}

export async function setSnoozed(workspaceId: string, contactId: string, snoozedUntil: Date | null) {
  return InboxConversationState.findOneAndUpdate(
    { workspaceId, contactId },
    snoozedUntil ? { $set: { snoozedUntil } } : { $unset: { snoozedUntil: '' } },
    { upsert: true, new: true },
  );
}
