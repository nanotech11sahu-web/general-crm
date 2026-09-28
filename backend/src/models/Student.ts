import { Schema, model, Document, Types } from 'mongoose';

export const STUDENT_STATUSES = ['active', 'alumni', 'transferred_certificate'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export interface IStudent extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  classId?: Types.ObjectId;
  section?: string;
  parentContactId?: Types.ObjectId;
  status: StudentStatus;
  admittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const studentSchema = new Schema<IStudent>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    classId: { type: Schema.Types.ObjectId, ref: 'SchoolClass' },
    section: { type: String, trim: true },
    parentContactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    status: { type: String, enum: STUDENT_STATUSES, default: 'active' },
    admittedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

export const Student = model<IStudent>('Student', studentSchema);
