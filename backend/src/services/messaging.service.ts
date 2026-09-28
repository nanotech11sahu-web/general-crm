import { Types } from 'mongoose';
import { Contact } from '../models/Contact';
import { EmailLog } from '../models/EmailLog';
import { WhatsAppLog } from '../models/WhatsAppLog';
import { OptOut } from '../models/OptOut';

export type MessageSource = 'campaign' | 'workflow' | 'test' | 'inbox';
export type SendResult = 'sent' | 'suppressed_dnd' | 'suppressed_optout';

export async function sendEmail(
  workspaceId: string | Types.ObjectId,
  contactId: string | Types.ObjectId,
  subject: string,
  source: MessageSource,
  campaignId?: string | Types.ObjectId,
): Promise<SendResult> {
  const contact = await Contact.findById(contactId);
  let status: SendResult = 'sent';

  if (!contact || contact.dnd?.blockAll || contact.dnd?.email) {
    status = 'suppressed_dnd';
  } else {
    const optOut = await OptOut.findOne({ workspaceId, contactId, channel: 'email' });
    if (optOut) status = 'suppressed_optout';
  }

  await EmailLog.create({ workspaceId, campaignId, contactId, subject, status, source });
  return status;
}

export async function sendWhatsApp(
  workspaceId: string | Types.ObjectId,
  contactId: string | Types.ObjectId,
  message: string,
  source: MessageSource,
): Promise<SendResult> {
  const contact = await Contact.findById(contactId);
  let status: SendResult = 'sent';

  if (!contact || contact.dnd?.blockAll || contact.dnd?.whatsapp) {
    status = 'suppressed_dnd';
  } else {
    const optOut = await OptOut.findOne({ workspaceId, contactId, channel: 'whatsapp' });
    if (optOut) status = 'suppressed_optout';
  }

  await WhatsAppLog.create({ workspaceId, contactId, message, status, source });
  return status;
}
