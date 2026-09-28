import { Types } from 'mongoose';
import { OnboardingTask } from '../models/OnboardingTask';
import { Membership } from '../models/Membership';
import { Contact } from '../models/Contact';
import { Pipeline } from '../models/Pipeline';
import { Form } from '../models/Form';
import { Funnel } from '../models/Funnel';
import { ChatWidget } from '../models/ChatWidget';
import { SmtpConnection } from '../models/SmtpConnection';
import { WabaAccount } from '../models/WabaAccount';
import { Workflow } from '../models/Workflow';
import { BulkCampaign } from '../models/BulkCampaign';
import { EventType } from '../models/EventType';
import { Appointment } from '../models/Appointment';
import { Product } from '../models/Product';
import { RazorpayConnection } from '../models/RazorpayConnection';
import { Invoice } from '../models/Invoice';
import { AiKnowledgeDoc } from '../models/AiKnowledgeDoc';
import { AiAgent } from '../models/AiAgent';
import { Project } from '../models/Project';
import { Staff } from '../models/Staff';
import { Role } from '../models/Role';
import { Course } from '../models/Course';
import { InboxConversationState } from '../models/InboxConversationState';
import { Domain } from '../models/Domain';
import { BrandingSettings } from '../models/BrandingSettings';
import { Tag } from '../models/Tag';
import { CustomField } from '../models/CustomField';
import { AppIntegration } from '../models/AppIntegration';

/**
 * Every check here queries the module's own real collection, so the checklist can
 * never go stale the way a stored flag flipped only at creation time would (the same
 * anti-staleness lesson Phase 7 learned the hard way with a cached AI Brain seed doc).
 */
const SIGNAL_CHECKS: Record<string, (wsId: Types.ObjectId) => Promise<boolean>> = {
  workspace_created: async () => true,
  profile_completed: async () => true,
  invite_team: async (wsId) => (await Membership.countDocuments({ workspaceId: wsId })) > 1,
  first_contact: async (wsId) => (await Contact.countDocuments({ workspaceId: wsId })) > 0,
  first_pipeline: async (wsId) => (await Pipeline.countDocuments({ workspaceId: wsId })) > 0,
  first_form: async (wsId) => (await Form.countDocuments({ workspaceId: wsId })) > 0,
  first_funnel: async (wsId) => (await Funnel.countDocuments({ workspaceId: wsId })) > 0,
  chat_widget: async (wsId) => (await ChatWidget.countDocuments({ workspaceId: wsId })) > 0,
  connect_email: async (wsId) => Boolean(await SmtpConnection.findOne({ workspaceId: wsId, connected: true })),
  connect_waba: async (wsId) => Boolean(await WabaAccount.findOne({ workspaceId: wsId, status: 'connected' })),
  first_workflow: async (wsId) => (await Workflow.countDocuments({ workspaceId: wsId })) > 0,
  first_campaign: async (wsId) => (await BulkCampaign.countDocuments({ workspaceId: wsId })) > 0,
  calendar_setup: async (wsId) => (await EventType.countDocuments({ workspaceId: wsId })) > 0,
  first_appointment: async (wsId) => (await Appointment.countDocuments({ workspaceId: wsId })) > 0,
  first_product: async (wsId) => (await Product.countDocuments({ workspaceId: wsId })) > 0,
  payment_gateway: async (wsId) => Boolean(await RazorpayConnection.findOne({ workspaceId: wsId, connected: true })),
  first_invoice: async (wsId) => (await Invoice.countDocuments({ workspaceId: wsId })) > 0,
  ai_brain_seeded: async (wsId) => (await AiKnowledgeDoc.countDocuments({ workspaceId: wsId })) > 0,
  first_ai_agent: async (wsId) => (await AiAgent.countDocuments({ workspaceId: wsId })) > 0,
  first_project: async (wsId) => (await Project.countDocuments({ workspaceId: wsId })) > 0,
  staff_added: async (wsId) => (await Staff.countDocuments({ workspaceId: wsId })) > 0,
  roles_configured: async (wsId) => (await Role.countDocuments({ workspaceId: wsId, isSystem: false })) > 0,
  first_course: async (wsId) => (await Course.countDocuments({ workspaceId: wsId })) > 0,
  inbox_connected: async (wsId) => (await InboxConversationState.countDocuments({ workspaceId: wsId })) > 0,
  domain_added: async (wsId) => (await Domain.countDocuments({ workspaceId: wsId })) > 0,
  branding_configured: async (wsId) => {
    const branding = await BrandingSettings.findOne({ workspaceId: wsId }).lean();
    return Boolean(branding && (branding.experienceName !== 'PMC Demo' || branding.primaryColor !== '#4f46e5'));
  },
  tags_configured: async (wsId) => (await Tag.countDocuments({ workspaceId: wsId, appliesTo: { $ne: ['Contact'] } })) > 0 || (await Tag.countDocuments({ workspaceId: wsId })) > 3,
  custom_fields_configured: async (wsId) => (await CustomField.countDocuments({ workspaceId: wsId, isStandard: false })) > 0,
  app_connected: async (wsId) => (await AppIntegration.countDocuments({ workspaceId: wsId, connected: true })) > 0,
  analytics_reviewed: async (wsId) => {
    const task = await OnboardingTask.findOne({ workspaceId: wsId, key: 'analytics_reviewed' }).lean();
    return Boolean(task?.completed);
  },
};

export async function recomputeOnboardingProgress(workspaceId: string) {
  const wsId = new Types.ObjectId(workspaceId);
  const tasks = await OnboardingTask.find({ workspaceId: wsId }).sort({ order: 1 });

  await Promise.all(
    tasks.map(async (task) => {
      if (task.completed) return;
      const check = SIGNAL_CHECKS[task.key];
      if (!check) return;
      const isDone = await check(wsId);
      if (isDone) {
        task.completed = true;
        task.completedAt = new Date();
        await task.save();
      }
    }),
  );

  const refreshed = await OnboardingTask.find({ workspaceId: wsId }).sort({ order: 1 }).lean();
  return { tasks: refreshed, completed: refreshed.filter((t) => t.completed).length, total: refreshed.length };
}

/** Direct-trigger tasks (a UI visit, not a persisted object) are marked here instead of recomputed live. */
export async function markOnboardingTaskComplete(workspaceId: string, key: string) {
  await OnboardingTask.updateOne(
    { workspaceId, key, completed: false },
    { $set: { completed: true, completedAt: new Date() } },
  );
}
