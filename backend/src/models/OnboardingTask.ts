import { Schema, model, Document, Types } from 'mongoose';

export interface IOnboardingTask extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  key: string;
  label: string;
  completed: boolean;
  completedAt?: Date;
  order: number;
}

const onboardingTaskSchema = new Schema<IOnboardingTask>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    order: { type: Number, default: 0 },
  },
  { timestamps: false },
);

onboardingTaskSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const OnboardingTask = model<IOnboardingTask>('OnboardingTask', onboardingTaskSchema);

export const ONBOARDING_CHECKLIST: { key: string; label: string }[] = [
  { key: 'workspace_created', label: 'Create your workspace' },
  { key: 'profile_completed', label: 'Complete your profile' },
  { key: 'invite_team', label: 'Invite a team member' },
  { key: 'first_contact', label: 'Add your first contact' },
  { key: 'first_pipeline', label: 'Set up a sales pipeline' },
  { key: 'first_form', label: 'Create a lead capture form' },
  { key: 'first_funnel', label: 'Publish a site/funnel page' },
  { key: 'chat_widget', label: 'Set up a chat widget' },
  { key: 'connect_email', label: 'Connect an email sender' },
  { key: 'connect_waba', label: 'Connect WhatsApp Business' },
  { key: 'first_workflow', label: 'Build a workflow automation' },
  { key: 'first_campaign', label: 'Launch a bulk campaign' },
  { key: 'calendar_setup', label: 'Create a booking calendar' },
  { key: 'first_appointment', label: 'Book a test appointment' },
  { key: 'first_product', label: 'Add a product' },
  { key: 'payment_gateway', label: 'Connect a payment gateway' },
  { key: 'first_invoice', label: 'Create an invoice' },
  { key: 'ai_brain_seeded', label: 'Seed the AI Brain' },
  { key: 'first_ai_agent', label: 'Install an AI agent template' },
  { key: 'first_project', label: 'Create a project' },
  { key: 'staff_added', label: 'Add a staff member' },
  { key: 'roles_configured', label: 'Configure roles & permissions' },
  { key: 'first_course', label: 'Create a community course' },
  { key: 'inbox_connected', label: 'Connect a channel to Inbox' },
  { key: 'domain_added', label: 'Add a custom domain' },
  { key: 'branding_configured', label: 'Configure white-label branding' },
  { key: 'tags_configured', label: 'Set up tags' },
  { key: 'custom_fields_configured', label: 'Add a custom field' },
  { key: 'app_connected', label: 'Connect an app from the App Store' },
  { key: 'analytics_reviewed', label: 'Review the analytics dashboard' },
];
