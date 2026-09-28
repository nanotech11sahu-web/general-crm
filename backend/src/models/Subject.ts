import { Schema, model, Document, Types } from 'mongoose';

export interface ISubject extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  classId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const subjectSchema = new Schema<ISubject>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    classId: { type: Schema.Types.ObjectId, ref: 'SchoolClass' },
  },
  { timestamps: true },
);

export const Subject = model<ISubject>('Subject', subjectSchema);
