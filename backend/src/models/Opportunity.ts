import { Schema, model, Document, Types } from 'mongoose';

export interface IOpportunity extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  pipelineId: Types.ObjectId;
  stageKey: string;
  name: string;
  productInterest?: string;
  city?: string;
  value?: number;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const opportunitySchema = new Schema<IOpportunity>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    pipelineId: { type: Schema.Types.ObjectId, ref: 'Pipeline', required: true, index: true },
    stageKey: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    productInterest: { type: String },
    city: { type: String },
    value: { type: Number },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

opportunitySchema.index({ workspaceId: 1, pipelineId: 1, stageKey: 1, order: 1 });

export const Opportunity = model<IOpportunity>('Opportunity', opportunitySchema);
