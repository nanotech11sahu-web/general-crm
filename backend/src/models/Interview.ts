import { Schema, model, Document, Types } from 'mongoose';

export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export interface IInterview extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  candidateId: Types.ObjectId;
  roleId: Types.ObjectId;
  interviewerStaffId?: Types.ObjectId;
  scheduledAt: Date;
  status: InterviewStatus;
  feedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

const interviewSchema = new Schema<IInterview>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'JobRole', required: true },
    interviewerStaffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    scheduledAt: { type: Date, required: true },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'scheduled' },
    feedback: { type: String },
  },
  { timestamps: true },
);

export const Interview = model<IInterview>('Interview', interviewSchema);
