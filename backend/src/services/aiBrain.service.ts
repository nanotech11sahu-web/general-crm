import { AiKnowledgeDoc } from '../models/AiKnowledgeDoc';
import { AiUnansweredQuestion } from '../models/AiUnansweredQuestion';
import { AI_BRAIN_PACKS, getBrainPack } from '../constants/aiBrainPacks';
import { callGateway } from './aiGateway.service';
import { EventType } from '../models/EventType';
import { Appointment } from '../models/Appointment';
import { VibeSearch } from '../models/VibeSearch';
import { Workflow } from '../models/Workflow';
import { WabaAccount } from '../models/WabaAccount';
import { EmailCampaign } from '../models/EmailCampaign';
import { Invoice } from '../models/Invoice';
import { Subscription } from '../models/Subscription';
import { AdCampaign } from '../models/AdCampaign';
import { Form } from '../models/Form';
import { FormSubmission } from '../models/FormSubmission';
import { ChatWidget } from '../models/ChatWidget';

const DAILY_TRAINING_QUESTIONS: Record<string, string> = {
  calendar: 'How many appointments were booked this month?',
  prospecting: 'How many searches has the team run this week?',
  workflows: 'How many workflows are currently published?',
  whatsapp: 'What is our WhatsApp account status?',
  emailMarketing: 'What is our average email open rate?',
  finance: 'What is our current MRR?',
  adLauncher: 'Which ad campaign is spending the most?',
  forms: 'Which form has the most submissions?',
  chatWidget: 'How many chat widgets are live?',
};

/** Builds one real-data-grounded seed doc per module. Modules without a built backend yet get an explicit placeholder. */
async function buildSeedContent(workspaceId: string, packKey: string): Promise<string> {
  switch (packKey) {
    case 'calendar': {
      const [eventTypes, appointments] = await Promise.all([
        EventType.countDocuments({ workspaceId, archived: false }),
        Appointment.countDocuments({ workspaceId }),
      ]);
      const published = await EventType.countDocuments({ workspaceId, status: 'published' });
      return `This workspace has ${eventTypes} calendar(s) configured, ${published} published and bookable. ${appointments} appointment(s) have been booked in total.`;
    }
    case 'prospecting': {
      const searches = await VibeSearch.find({ workspaceId }).lean();
      const totalCredits = searches.reduce((sum, s) => sum + s.creditsSpent, 0);
      return `The team has run ${searches.length} Vibe Prospecting search(es), spending ${totalCredits} credit(s) total.`;
    }
    case 'workflows': {
      const [total, published] = await Promise.all([
        Workflow.countDocuments({ workspaceId, archived: false }),
        Workflow.countDocuments({ workspaceId, status: 'published', archived: false }),
      ]);
      return `This workspace has ${total} workflow(s) built, ${published} of them published and live.`;
    }
    case 'whatsapp': {
      const account = await WabaAccount.findOne({ workspaceId }).lean();
      if (!account || account.status === 'not_connected') {
        return 'WhatsApp (WABA) is not connected yet for this workspace.';
      }
      return `WhatsApp (WABA) is connected. Quality rating: ${account.qualityRating ?? 'unrated'}. Messaging limit: ${account.messagingLimit}. Auto opt-out is ${account.autoOptOutEnabled ? 'enabled' : 'disabled'}.`;
    }
    case 'emailMarketing': {
      const campaigns = await EmailCampaign.find({ workspaceId }).lean();
      const sent = campaigns.reduce((s, c) => s + c.sentCount, 0);
      const opened = campaigns.reduce((s, c) => s + c.openedCount, 0);
      const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
      return `This workspace has ${campaigns.length} email campaign(s). ${sent} email(s) sent in total, with an average open rate of ${openRate}%.`;
    }
    case 'finance': {
      const [subscriptions, invoices] = await Promise.all([Subscription.find({ workspaceId }).lean(), Invoice.find({ workspaceId }).lean()]);
      const active = subscriptions.filter((s) => s.status === 'active');
      const mrr = active.reduce((sum, s) => sum + (s.billingCycle === 'yearly' ? s.price / 12 : s.price), 0);
      const overdue = invoices.filter((i) => i.status === 'overdue').length;
      return `Current MRR is ₹${Math.round(mrr).toLocaleString()} across ${active.length} active subscription(s). There are ${overdue} overdue invoice(s) out of ${invoices.length} total.`;
    }
    case 'adLauncher': {
      const campaigns = await AdCampaign.find({ workspaceId }).lean();
      const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
      const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
      return `This workspace is running ${campaigns.length} ad campaign(s), with ₹${Math.round(totalSpend).toLocaleString()} spent and ${totalLeads} lead(s) generated so far.`;
    }
    case 'forms': {
      const forms = await Form.find({ workspaceId, archived: false }).lean();
      const submissionCounts = await Promise.all(forms.map((f) => FormSubmission.countDocuments({ formId: f._id })));
      const totalSubmissions = submissionCounts.reduce((s, c) => s + c, 0);
      return `This workspace has ${forms.length} form(s) with ${totalSubmissions} submission(s) collected in total.`;
    }
    case 'chatWidget': {
      const widgets = await ChatWidget.find({ workspaceId }).lean();
      const active = widgets.filter((w) => w.status === 'active').length;
      return `This workspace has ${widgets.length} chat widget(s) configured, ${active} of them live on a site.`;
    }
    default:
      return `The ${getBrainPack(packKey)?.name ?? packKey} module ships in a later phase, so this pack has no real data to seed from yet. Seeded automatically by the internal AI assistant.`;
  }
}

export async function listPacksWithStats(workspaceId: string) {
  const packs = await Promise.all(
    AI_BRAIN_PACKS.map(async (pack) => {
      const [docCount, unansweredCount] = await Promise.all([
        AiKnowledgeDoc.countDocuments({ workspaceId, packKey: pack.key }),
        AiUnansweredQuestion.countDocuments({ workspaceId, packKey: pack.key, resolved: false }),
      ]);
      return { ...pack, docCount, unansweredCount };
    }),
  );
  return packs;
}

/**
 * Keeps the pack's one seeded doc in sync with real workspace data every time it's read —
 * a seed snapshot that never refreshes would answer questions from stale figures (e.g. MRR)
 * as soon as the underlying data changed, which defeats the point of grounding answers in
 * "real data" at all. Re-generates in place rather than accumulating a new doc per read.
 */
export async function ensureSeeded(workspaceId: string, packKey: string): Promise<void> {
  const pack = getBrainPack(packKey);
  const content = await buildSeedContent(workspaceId, packKey);
  await AiKnowledgeDoc.findOneAndUpdate(
    { workspaceId, packKey, type: 'seeded' },
    { $set: { content, title: `${pack?.name ?? packKey} overview` } },
    { upsert: true },
  );
}

export async function getPackDetail(workspaceId: string, packKey: string) {
  await ensureSeeded(workspaceId, packKey);
  const [docs, unanswered] = await Promise.all([
    AiKnowledgeDoc.find({ workspaceId, packKey }).sort({ createdAt: -1 }).lean(),
    AiUnansweredQuestion.find({ workspaceId, packKey }).sort({ createdAt: -1 }).lean(),
  ]);
  return { pack: getBrainPack(packKey), docs, unanswered, dailyTrainingQuestion: DAILY_TRAINING_QUESTIONS[packKey] ?? `What would you like to know about ${getBrainPack(packKey)?.name ?? packKey}?` };
}

export async function addKnowledge(workspaceId: string, packKey: string, type: 'memory' | 'document' | 'faq', title: string, content: string) {
  return AiKnowledgeDoc.create({ workspaceId, packKey, type, title, content });
}

function keywordOverlap(question: string, content: string): number {
  const qWords = new Set(question.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const cWords = new Set(content.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let overlap = 0;
  for (const w of qWords) {
    if (w.length > 2 && cWords.has(w)) overlap += 1;
  }
  return overlap;
}

export async function chatWithBrain(workspaceId: string, packKey: string, question: string) {
  await ensureSeeded(workspaceId, packKey);
  const docs = await AiKnowledgeDoc.find({ workspaceId, packKey }).lean();

  let best: { content: string; score: number } | null = null;
  for (const doc of docs) {
    const score = keywordOverlap(question, `${doc.title} ${doc.content}`);
    if (score > 0 && (!best || score > best.score)) {
      best = { content: doc.content, score };
    }
  }

  // A seeded doc always exists for every pack (ensureSeeded guarantees it), so fall back to it
  // when no keyword overlap is found rather than treating every open-ended question as unanswered.
  const grounded = best?.content ?? docs.find((d) => d.type === 'seeded')?.content ?? '';

  const result = await callGateway({
    workspaceId,
    purpose: 'brainChat',
    prompt: question,
    context: { matchedContent: grounded },
  });

  if (!best) {
    await AiUnansweredQuestion.create({ workspaceId, packKey, question });
  }

  return { answer: result.content, grounded: best !== null };
}

export async function resolveUnanswered(workspaceId: string, id: string) {
  return AiUnansweredQuestion.findOneAndUpdate({ _id: id, workspaceId }, { $set: { resolved: true } }, { new: true });
}
