export const LOCATION_TYPES = ['zoom', 'google_meet', 'phone', 'in_person'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const ASSIGNMENT_METHODS = ['round_robin', 'all_staff', 'specific'] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

export interface AvailabilityWindow {
  day: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface BookingFormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'textarea' | 'select';
  required: boolean;
  options?: string[];
}

export interface EventTypeDoc {
  _id: string;
  workspaceId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  locationType: LocationType;
  locationDetails?: string;
  availability: AvailabilityWindow[];
  timezone: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeHours: number;
  dateRangeDays: number;
  staffMembershipIds: string[];
  assignmentMethod: AssignmentMethod;
  requirePayment: boolean;
  price: number;
  currency: string;
  requireApproval: boolean;
  confirmationMessage?: string;
  bookingFormFields: BookingFormField[];
  templateKey: string;
  templateCategory: string;
  status: 'draft' | 'published';
  publicId: string;
  createdAt: string;
}

export const APPOINTMENT_STATUSES = ['Booked', 'Awaiting Payment', 'Cancelled', 'Show Up', 'No Show', 'Rescheduled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface AppointmentDoc {
  _id: string;
  workspaceId: string;
  eventTypeId: string;
  contactId: string;
  staffMembershipId?: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  formResponses: Record<string, unknown>;
  notes?: string;
  createdAt: string;
}

export interface CalendarTemplateDefinition {
  key: string;
  name: string;
  category: string;
  durationMinutes: number;
  serviceCount: number;
  badge: string;
}

export interface LeaderboardRow {
  membershipId: string;
  name: string;
  verifiedRevenue: number;
  totalActions: number;
  callsMade: number;
  avgResponseSeconds: number | null;
  activeNow: boolean;
}

export interface IncentiveSettingDoc {
  _id: string;
  membershipId: string;
  incentiveAmount: number;
  notes?: string;
}

export interface WebinarDoc {
  _id: string;
  topic: string;
  description?: string;
  coverImage?: string;
  scheduleType: 'one_time' | 'recurring';
  startAt: string;
  durationMinutes: number;
  timezone: string;
  recurrence?: string;
  options: {
    requireRegistration: boolean;
    restrictToRegistered: boolean;
    enableRecording: boolean;
    enableQnA: boolean;
    enablePolls: boolean;
    enableChat: boolean;
    altHostEmails: string[];
  };
  registration: { mode: 'built_in' | 'site_funnel' | 'external'; externalUrl?: string; funnelId?: string };
  status: 'draft' | 'scheduled' | 'completed' | 'cancelled';
  joinLink?: string;
  createdAt: string;
}

export interface CallLogDoc {
  _id: string;
  direction: 'inbound' | 'outbound';
  status: 'completed' | 'missed' | 'in_progress' | 'failed';
  fromNumber: string;
  toNumber: string;
  agentMembershipId?: string;
  contactId?: string;
  source?: string;
  durationSeconds: number;
  createdAt: string;
}

export interface CallProviderDoc {
  key: string;
  name: string;
  connected: boolean;
}

export const PROPOSAL_STATUSES = ['Built', 'Published', 'Sent', 'Viewed', 'Approved', 'Declined', 'Converted'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalDoc {
  _id: string;
  name: string;
  contactId?: string;
  opportunityId?: string;
  value: number;
  content: string;
  templateName: string;
  status: ProposalStatus;
  publicId: string;
  signatureName?: string;
  sentAt?: string;
  viewedAt?: string;
  respondedAt?: string;
  createdAt: string;
}
