import { Schema, model, Document, Types } from 'mongoose';

export interface IPipelineStage {
  key: string;
  label: string;
  order: number;
}

export interface IPipeline extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  stages: IPipelineStage[];
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema<IPipelineStage>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    order: { type: Number, required: true },
  },
  { _id: false },
);

const pipelineSchema = new Schema<IPipeline>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    stages: { type: [stageSchema], default: [] },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

pipelineSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const DEFAULT_B2B_STAGES: IPipelineStage[] = [
  { key: 'new_lead', label: 'New Lead', order: 0 },
  { key: 'contacted', label: 'Contacted', order: 1 },
  { key: 'qualified', label: 'Qualified', order: 2 },
  { key: 'discovery_call', label: 'Discovery Call', order: 3 },
  { key: 'proposal_sent', label: 'Proposal Sent', order: 4 },
  { key: 'negotiation', label: 'Negotiation', order: 5 },
  { key: 'closed_won', label: 'Closed Won', order: 6 },
  { key: 'closed_lost', label: 'Closed Lost', order: 7 },
];

export const Pipeline = model<IPipeline>('Pipeline', pipelineSchema);
