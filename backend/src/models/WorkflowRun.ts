import { Schema, model, Document, Types } from 'mongoose';

export interface IWorkflowStepLog {
  nodeId: string;
  kind: string;
  status: 'success' | 'skipped' | 'failed';
  message: string;
}

export interface IWorkflowRun extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  workflowId: Types.ObjectId;
  triggerKey: string;
  contactId?: Types.ObjectId;
  status: 'success' | 'partial' | 'failed';
  steps: IWorkflowStepLog[];
  isTestRun: boolean;
  createdAt: Date;
}

const stepLogSchema = new Schema<IWorkflowStepLog>(
  {
    nodeId: { type: String, required: true },
    kind: { type: String, required: true },
    status: { type: String, enum: ['success', 'skipped', 'failed'], required: true },
    message: { type: String, required: true },
  },
  { _id: false },
);

const workflowRunSchema = new Schema<IWorkflowRun>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true, index: true },
    triggerKey: { type: String, required: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    status: { type: String, enum: ['success', 'partial', 'failed'], required: true },
    steps: { type: [stepLogSchema], default: [] },
    isTestRun: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const WorkflowRun = model<IWorkflowRun>('WorkflowRun', workflowRunSchema);
