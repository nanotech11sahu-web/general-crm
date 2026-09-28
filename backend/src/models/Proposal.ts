import { Schema, model, Document, Types } from 'mongoose';

export const PROPOSAL_STATUSES = ['Built', 'Published', 'Sent', 'Viewed', 'Approved', 'Declined', 'Converted'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface IProposal extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  contactId?: Types.ObjectId;
  opportunityId?: Types.ObjectId;
  value: number;
  content: string;
  templateName: string;
  status: ProposalStatus;
  publicId: string;
  signatureName?: string;
  sentAt?: Date;
  viewedAt?: Date;
  respondedAt?: Date;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const proposalSchema = new Schema<IProposal>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    opportunityId: { type: Schema.Types.ObjectId, ref: 'Opportunity' },
    value: { type: Number, default: 0 },
    content: { type: String, default: '' },
    templateName: { type: String, default: 'Standard Proposal' },
    status: { type: String, enum: PROPOSAL_STATUSES, default: 'Built' },
    publicId: { type: String, required: true, unique: true },
    signatureName: { type: String },
    sentAt: { type: Date },
    viewedAt: { type: Date },
    respondedAt: { type: Date },
    archived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

export const Proposal = model<IProposal>('Proposal', proposalSchema);
