import { Types } from 'mongoose';
import { OptOut, OPT_OUT_KEYWORDS } from '../models/OptOut';

export function matchOptOutKeyword(text: string): string | null {
  const normalized = text.trim().toUpperCase();
  const match = OPT_OUT_KEYWORDS.find((keyword) => normalized === keyword);
  return match ?? null;
}

export async function processInboundWhatsAppMessage(
  workspaceId: string | Types.ObjectId,
  contactId: string | Types.ObjectId,
  text: string,
): Promise<{ optedOut: boolean; keyword: string | null }> {
  const keyword = matchOptOutKeyword(text);
  if (!keyword) return { optedOut: false, keyword: null };

  await OptOut.findOneAndUpdate(
    { workspaceId, contactId, channel: 'whatsapp' },
    { $setOnInsert: { workspaceId, contactId, channel: 'whatsapp', keyword } },
    { upsert: true },
  );

  return { optedOut: true, keyword };
}
