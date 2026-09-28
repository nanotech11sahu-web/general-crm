import { Schema, model, Document, Types } from 'mongoose';

export interface IAcademicYear extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  startDate: Date;
  endDate: Date;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const academicYearSchema = new Schema<IAcademicYear>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const AcademicYear = model<IAcademicYear>('AcademicYear', academicYearSchema);
