import { IContact } from '../models/Contact';
import { Contact } from '../models/Contact';
import { Opportunity } from '../models/Opportunity';
import { ContactNote } from '../models/ContactNote';
import { TimelineEvent } from '../models/TimelineEvent';
import { LeadScoreLog, ILeadScoreSignal } from '../models/LeadScoreLog';

const LIFECYCLE_WEIGHT: Record<string, number> = {
  Lead: 0,
  MQL: 10,
  SQL: 20,
  Opportunity: 30,
  Customer: 40,
  Evangelist: 40,
};

export interface LeadScoringContext {
  openOpportunityCount: number;
  recentTimelineEventCount: number;
  notesCount: number;
}

export interface LeadScoringResult {
  score: number;
  signals: ILeadScoreSignal[];
}

export function computeLeadScore(
  contact: Pick<IContact, 'email' | 'phone' | 'company' | 'temperature' | 'lifecycleStage' | 'leadValue' | 'dnd'>,
  context: LeadScoringContext,
): LeadScoringResult {
  const signals: ILeadScoreSignal[] = [];

  if (contact.email) signals.push({ key: 'has_email', label: 'Has email address', weight: 10 });
  if (contact.phone) signals.push({ key: 'has_phone', label: 'Has phone number', weight: 10 });
  if (contact.company) signals.push({ key: 'has_company', label: 'Has company on file', weight: 5 });

  if (contact.temperature === 'Hot') {
    signals.push({ key: 'temperature_hot', label: 'Marked as Hot', weight: 20 });
  } else if (contact.temperature === 'Warm') {
    signals.push({ key: 'temperature_warm', label: 'Marked as Warm', weight: 10 });
  }

  const lifecycleWeight = LIFECYCLE_WEIGHT[contact.lifecycleStage] ?? 0;
  if (lifecycleWeight > 0) {
    signals.push({ key: 'lifecycle_stage', label: `Lifecycle stage: ${contact.lifecycleStage}`, weight: lifecycleWeight });
  }

  if (context.openOpportunityCount > 0) {
    signals.push({ key: 'has_open_opportunity', label: 'Has an open pipeline opportunity', weight: 10 });
  }

  const activityWeight = Math.min(context.recentTimelineEventCount * 2, 20);
  if (activityWeight > 0) {
    signals.push({
      key: 'recent_activity',
      label: `${context.recentTimelineEventCount} timeline events in the last 14 days`,
      weight: activityWeight,
    });
  }

  const notesWeight = Math.min(context.notesCount * 2, 10);
  if (notesWeight > 0) {
    signals.push({ key: 'notes_logged', label: `${context.notesCount} notes logged`, weight: notesWeight });
  }

  if (contact.leadValue && contact.leadValue > 0) {
    signals.push({ key: 'has_lead_value', label: 'Lead value estimated', weight: 5 });
  }

  if (contact.dnd?.blockAll) {
    signals.push({ key: 'dnd_blocked', label: 'All channels blocked (Do Not Disturb)', weight: -20 });
  }

  const rawScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const score = Math.max(0, Math.min(100, rawScore));

  return { score, signals };
}

export async function recalculateContactScore(contactId: string): Promise<LeadScoringResult | null> {
  const contact = await Contact.findById(contactId);
  if (!contact) return null;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [openOpportunityCount, recentTimelineEventCount, notesCount] = await Promise.all([
    Opportunity.countDocuments({ contactId, stageKey: { $nin: ['closed_won', 'closed_lost'] } }),
    TimelineEvent.countDocuments({ contactId, createdAt: { $gte: fourteenDaysAgo } }),
    ContactNote.countDocuments({ contactId }),
  ]);

  const result = computeLeadScore(contact, { openOpportunityCount, recentTimelineEventCount, notesCount });

  contact.leadScore = result.score;
  contact.leadScoreUpdatedAt = new Date();
  await contact.save();

  await LeadScoreLog.create({
    workspaceId: contact.workspaceId,
    contactId: contact._id,
    score: result.score,
    signals: result.signals,
  });

  return result;
}

export async function recalculateAllContactScores(workspaceId?: string): Promise<number> {
  const filter = workspaceId ? { workspaceId, archived: false } : { archived: false };
  const contacts = await Contact.find(filter).select('_id').lean();
  for (const c of contacts) {
    await recalculateContactScore(String(c._id));
  }
  return contacts.length;
}
