import { Schema, model, Document, Types } from 'mongoose';

export const LEAVE_TYPES = ['Sick', 'Casual', 'Earned', 'Unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

export interface ILeaveRequest extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  staffId: Types.ObjectId;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  reason?: string;
  status: LeaveStatus;
  createdAt: Date;
  updatedAt: Date;
}

const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true, index: true },
    type: { type: String, enum: LEAVE_TYPES, default: 'Casual' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String },
    status: { type: String, enum: LEAVE_STATUSES, default: 'pending' },
  },
  { timestamps: true },
);

export const LeaveRequest = model<ILeaveRequest>('LeaveRequest', leaveRequestSchema);
