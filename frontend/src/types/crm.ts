export type Temperature = 'Hot' | 'Warm' | 'Cold';
export type LifecycleStage = 'Lead' | 'MQL' | 'SQL' | 'Opportunity' | 'Customer' | 'Evangelist';

export interface Attribution {
  source?: string;
  medium?: string;
  campaign?: string;
  date?: string;
}

export interface Contact {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  jobTitle?: string;
  city?: string;
  country?: string;
  tagIds: string[];
  lifecycleStage: LifecycleStage;
  temperature: Temperature;
  contactType: string;
  leadValue?: number;
  attributionFirst?: Attribution;
  attributionLatest?: Attribution;
  assignedCloserIds: string[];
  dnd: { email: boolean; whatsapp: boolean; waba: boolean; calls: boolean; blockAll: boolean };
  aiPulseScore: number;
  leadScore: number;
  leadScoreUpdatedAt?: string;
  source: string;
  isDemo: boolean;
  archived: boolean;
  customFieldValues?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  key: string;
  label: string;
  order: number;
}

export interface Pipeline {
  _id: string;
  name: string;
  stages: PipelineStage[];
  isDefault: boolean;
}

export interface Opportunity {
  _id: string;
  contactId: string;
  pipelineId: string;
  stageKey: string;
  name: string;
  productInterest?: string;
  city?: string;
  value?: number;
  order: number;
  createdAt: string;
}

export interface ContactNote {
  _id: string;
  body: string;
  authorId: string;
  createdAt: string;
}

export interface TimelineEvent {
  _id: string;
  type: string;
  message: string;
  createdAt: string;
}

export interface LeadScoreSignal {
  key: string;
  label: string;
  weight: number;
}
