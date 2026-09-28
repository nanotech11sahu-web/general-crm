import { Schema, model, Document, Types } from 'mongoose';

export const CANDIDATE_STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export interface ICandidate extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  roleId: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  stage: CandidateStage;
  appliedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const candidateSchema = new Schema<ICandidate>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    stage: { type: String, enum: CANDIDATE_STAGES, default: 'Applied' },
    appliedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

export const Candidate = model<ICandidate>('Candidate', candidateSchema);
