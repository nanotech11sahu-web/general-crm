import { PlatformEvent } from '../lib/eventBus';

export interface TriggerDefinition {
  key: PlatformEvent | string;
  label: string;
  category:
    | 'Contact Events'
    | 'Inbox Events'
    | 'Form/Lead Events'
    | 'CRM/Pipeline Events'
    | 'Calendar Events'
    | 'Finance Events'
    | 'Community Events'
    | 'External Apps'
    | 'Email Marketing';
  /** Whether this event is actually emitted by its owning module today. */
  wired: boolean;
}

/**
 * The full trigger taxonomy from the build spec. Every trigger is typed here so the
 * Workflow Builder's trigger picker reflects the real catalog. `wired: true` triggers
 * fire for real via the Phase 0 event bus today; the rest belong to modules that ship
 * in later phases (Calendar/Phase 5, Finance/Phase 6, Community/Phase 9, Inbox/Phase 9)
 * and are listed so the taxonomy is complete, per the build prompt's own instruction
 * to treat the trigger library as core infrastructure, not decoration.
 */
export const TRIGGER_CATALOG: TriggerDefinition[] = [
  // Contact Events (9)
  { key: 'contact.created', label: 'Contact Created', category: 'Contact Events', wired: true },
  { key: 'contact.updated', label: 'Contact Updated', category: 'Contact Events', wired: false },
  { key: 'contact.lifecycleStageChanged', label: 'Lifecycle Stage Changed', category: 'Contact Events', wired: true },
  { key: 'contact.tagAdded', label: 'Tag Added', category: 'Contact Events', wired: true },
  { key: 'contact.tagRemoved', label: 'Tag Removed', category: 'Contact Events', wired: false },
  { key: 'contact.archived', label: 'Contact Archived', category: 'Contact Events', wired: false },
  { key: 'contact.deleted', label: 'Contact Deleted', category: 'Contact Events', wired: false },
  { key: 'contact.dndChanged', label: 'Do Not Disturb Changed', category: 'Contact Events', wired: false },
  { key: 'contact.noteAdded', label: 'Note Added', category: 'Contact Events', wired: false },

  // Inbox Events (1) — Phase 9
  { key: 'inbox.messageReceived', label: 'Message Received', category: 'Inbox Events', wired: true },

  // Form/Lead Events (3)
  { key: 'form.submitted', label: 'Form Submitted', category: 'Form/Lead Events', wired: true },
  { key: 'lead.metaFormSubmitted', label: 'Meta Lead Form Submitted', category: 'Form/Lead Events', wired: false },
  { key: 'lead.chatWidgetCaptured', label: 'Chat Widget Lead Captured', category: 'Form/Lead Events', wired: false },

  // CRM/Pipeline Events (13, abbreviated set wired)
  { key: 'contact.stageChanged', label: 'Pipeline Stage Changed', category: 'CRM/Pipeline Events', wired: true },
  { key: 'opportunity.created', label: 'Opportunity Created', category: 'CRM/Pipeline Events', wired: false },
  { key: 'opportunity.won', label: 'Opportunity Won', category: 'CRM/Pipeline Events', wired: false },
  { key: 'opportunity.lost', label: 'Opportunity Lost', category: 'CRM/Pipeline Events', wired: false },
  { key: 'opportunity.deleted', label: 'Opportunity Deleted', category: 'CRM/Pipeline Events', wired: false },
  { key: 'pipeline.created', label: 'Pipeline Created', category: 'CRM/Pipeline Events', wired: false },
  { key: 'leadScore.crossedThreshold', label: 'Lead Score Crossed Threshold', category: 'CRM/Pipeline Events', wired: false },
  { key: 'leadScore.recalculated', label: 'Lead Score Recalculated', category: 'CRM/Pipeline Events', wired: false },
  { key: 'assignedCloser.changed', label: 'Assigned Closer Changed', category: 'CRM/Pipeline Events', wired: false },
  { key: 'contactType.changed', label: 'Contact Type Changed', category: 'CRM/Pipeline Events', wired: false },
  { key: 'attribution.captured', label: 'Attribution Captured', category: 'CRM/Pipeline Events', wired: false },
  { key: 'temperature.changed', label: 'Temperature Changed', category: 'CRM/Pipeline Events', wired: false },
  { key: 'leadValue.updated', label: 'Lead Value Updated', category: 'CRM/Pipeline Events', wired: false },

  // Calendar Events (7) — Phase 5
  { key: 'calendar.appointmentBooked', label: 'Appointment Booked', category: 'Calendar Events', wired: true },
  { key: 'calendar.appointmentCancelled', label: 'Appointment Cancelled', category: 'Calendar Events', wired: true },
  { key: 'calendar.appointmentRescheduled', label: 'Appointment Rescheduled', category: 'Calendar Events', wired: true },
  { key: 'calendar.noShow', label: 'No Show', category: 'Calendar Events', wired: true },
  { key: 'calendar.showUp', label: 'Show Up', category: 'Calendar Events', wired: true },
  { key: 'calendar.awaitingPayment', label: 'Awaiting Payment', category: 'Calendar Events', wired: false },
  { key: 'calendar.reminderDue', label: 'Reminder Due', category: 'Calendar Events', wired: false },

  // Finance Events (11) — Phase 6
  { key: 'finance.invoiceCreated', label: 'Invoice Created', category: 'Finance Events', wired: true },
  { key: 'finance.invoicePaid', label: 'Invoice Paid', category: 'Finance Events', wired: true },
  { key: 'finance.invoiceOverdue', label: 'Invoice Overdue', category: 'Finance Events', wired: true },
  { key: 'finance.subscriptionCreated', label: 'Subscription Created', category: 'Finance Events', wired: true },
  { key: 'finance.subscriptionPaid', label: 'Subscription Paid', category: 'Finance Events', wired: true },
  { key: 'finance.subscriptionOverdue', label: 'Subscription Overdue', category: 'Finance Events', wired: true },
  { key: 'finance.subscriptionCancelled', label: 'Subscription Cancelled', category: 'Finance Events', wired: true },
  { key: 'finance.installmentCreated', label: 'Installment Created', category: 'Finance Events', wired: true },
  { key: 'finance.installmentPaid', label: 'Installment Paid', category: 'Finance Events', wired: true },
  { key: 'finance.installmentOverdue', label: 'Installment Overdue', category: 'Finance Events', wired: true },
  { key: 'finance.oneTimePayment', label: 'One-Time Payment', category: 'Finance Events', wired: true },

  // Community Events (10) — Phase 9
  { key: 'community.courseAccessGranted', label: 'Course Access Granted', category: 'Community Events', wired: true },
  { key: 'community.enrollment', label: 'Enrollment', category: 'Community Events', wired: true },
  { key: 'community.memberJoined', label: 'Member Joined', category: 'Community Events', wired: false },
  { key: 'community.postCreated', label: 'Post Created', category: 'Community Events', wired: false },
  { key: 'community.eventRegistered', label: 'Event Registered', category: 'Community Events', wired: false },
  { key: 'community.xpAwarded', label: 'XP Awarded', category: 'Community Events', wired: false },
  { key: 'community.badgeEarned', label: 'Badge Earned', category: 'Community Events', wired: false },
  { key: 'community.orderPlaced', label: 'Order Placed', category: 'Community Events', wired: false },
  { key: 'community.couponRedeemed', label: 'Coupon Redeemed', category: 'Community Events', wired: false },
  { key: 'community.leaderboardChanged', label: 'Leaderboard Changed', category: 'Community Events', wired: false },

  // External Apps / integrations
  { key: 'external.webhookReceived', label: 'External Webhook Received', category: 'External Apps', wired: false },
  { key: 'external.metaLeadForm', label: 'Meta Lead Form (App Store)', category: 'External Apps', wired: false },

  // Email Marketing
  { key: 'emailMarketing.enrollment', label: 'Email Marketing Enrollment', category: 'Email Marketing', wired: false },
];

export function getWiredTriggerKeys(): string[] {
  return TRIGGER_CATALOG.filter((t) => t.wired).map((t) => t.key);
}
