import { Schema, model, Document, Types } from 'mongoose';

export const ACTION_KINDS = ['add_tag', 'update_lifecycle_stage', 'send_email', 'send_whatsapp'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface IWorkflowNode {
  id: string;
  kind: 'trigger' | ActionKind;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface IWorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface IWorkflow extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  status: 'draft' | 'published';
  triggerKey: string;
  nodes: IWorkflowNode[];
  edges: IWorkflowEdge[];
  version: number;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const nodeSchema = new Schema<IWorkflowNode>(
  {
    id: { type: String, required: true },
    kind: { type: String, required: true },
    position: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
    },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const edgeSchema = new Schema<IWorkflowEdge>(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    target: { type: String, required: true },
  },
  { _id: false },
);

const workflowSchema = new Schema<IWorkflow>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    triggerKey: { type: String, required: true },
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    version: { type: Number, default: 1 },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Workflow = model<IWorkflow>('Workflow', workflowSchema);
