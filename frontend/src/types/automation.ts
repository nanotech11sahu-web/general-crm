export type ActionKind = 'add_tag' | 'update_lifecycle_stage' | 'send_email' | 'send_whatsapp';

export interface WorkflowNodeData {
  id: string;
  kind: 'trigger' | ActionKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowEdgeData {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDoc {
  _id: string;
  name: string;
  status: 'draft' | 'published';
  triggerKey: string;
  nodes: WorkflowNodeData[];
  edges: WorkflowEdgeData[];
  version: number;
  createdAt: string;
}

export interface TriggerDefinition {
  key: string;
  label: string;
  category: string;
  wired: boolean;
}

export interface WorkflowRunStep {
  nodeId: string;
  kind: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
}

export interface WorkflowRunDoc {
  _id: string;
  status: 'success' | 'partial' | 'failed';
  steps: WorkflowRunStep[];
  isTestRun: boolean;
  createdAt: string;
}

export interface EmailCampaignDoc {
  _id: string;
  name: string;
  subject: string;
  status: 'draft' | 'sent';
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  createdAt: string;
}

export interface WabaAccountDoc {
  status: 'not_connected' | 'connected';
  onboardingType: 'own_number' | 'coexistence' | null;
  billingMode: 'byob' | 'credit_line' | null;
  qualityRating: string | null;
  tier: string | null;
  messagingLimit: number;
  autoOptOutEnabled: boolean;
}

export interface WabaTemplateDoc {
  _id: string;
  name: string;
  body: string;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected';
}

export interface BulkCampaignDoc {
  _id: string;
  name: string;
  channels: ('email' | 'whatsapp')[];
  status: 'draft' | 'scheduled' | 'running' | 'completed';
  recipientCount: number;
  sentCount: number;
  createdAt: string;
}
