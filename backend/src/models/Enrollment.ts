import { Schema, model, Document, Types } from 'mongoose';

export interface IEnrollment extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  courseId: Types.ObjectId;
  contactId: Types.ObjectId;
  status: 'active' | 'completed';
  transactionId?: Types.ObjectId;
  enrolledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const enrollmentSchema = new Schema<IEnrollment>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    courseId: { type: Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'FinanceTransaction' },
    enrolledAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

enrollmentSchema.index({ workspaceId: 1, courseId: 1, contactId: 1 }, { unique: true });

export const Enrollment = model<IEnrollment>('Enrollment', enrollmentSchema);
