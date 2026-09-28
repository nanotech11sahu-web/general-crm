import { Schema, model, Document, Types } from 'mongoose';

export interface IDepartment extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<IDepartment>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

departmentSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const Department = model<IDepartment>('Department', departmentSchema);
