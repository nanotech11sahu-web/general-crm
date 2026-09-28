import { Schema, model, Document, Types } from 'mongoose';

export interface ISchoolClass extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  sections: string[];
  createdAt: Date;
  updatedAt: Date;
}

const schoolClassSchema = new Schema<ISchoolClass>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    sections: { type: [String], default: ['A'] },
  },
  { timestamps: true },
);

export const SchoolClass = model<ISchoolClass>('SchoolClass', schoolClassSchema);
