import { Schema, model, Document, Types } from 'mongoose';

export const JOB_ROLE_STATUSES = ['open', 'on-hold', 'closed'] as const;
export type JobRoleStatus = (typeof JOB_ROLE_STATUSES)[number];

export interface IJobRole extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  title: string;
  department?: string;
  location?: string;
  active: boolean;
  status: JobRoleStatus;
  openings: number;
  salaryRangeMin?: number;
  salaryRangeMax?: number;
  createdAt: Date;
  updatedAt: Date;
}

const jobRoleSchema = new Schema<IJobRole>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    title: { type: String, required: true, trim: true },
    department: { type: String, trim: true },
    location: { type: String, trim: true },
    active: { type: Boolean, default: true },
    status: { type: String, enum: JOB_ROLE_STATUSES, default: 'open' },
    openings: { type: Number, default: 1 },
    salaryRangeMin: { type: Number },
    salaryRangeMax: { type: Number },
  },
  { timestamps: true },
);

export const JobRole = model<IJobRole>('JobRole', jobRoleSchema);
