import { Schema, model, Document, Types } from 'mongoose';

export const STAFF_STATUSES = ['active', 'inactive'] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];

export interface IStaff extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId?: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  managerId?: Types.ObjectId;
  status: StaffStatus;
  isTeacher: boolean;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const staffSchema = new Schema<IStaff>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    department: { type: String, trim: true },
    jobTitle: { type: String, trim: true },
    managerId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    status: { type: String, enum: STAFF_STATUSES, default: 'active' },
    isTeacher: { type: Boolean, default: false },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

staffSchema.index({ workspaceId: 1, status: 1 });

export const Staff = model<IStaff>('Staff', staffSchema);
