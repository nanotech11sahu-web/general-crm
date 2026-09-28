import { Schema, model, Document, Types } from 'mongoose';
import { MODULES } from '../constants/modules';

export interface ILeadershipTitle extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  overrides: Partial<Record<(typeof MODULES)[number], Partial<Record<'read' | 'create' | 'edit' | 'delete', boolean>>>>;
  createdAt: Date;
  updatedAt: Date;
}

const leadershipTitleSchema = new Schema<ILeadershipTitle>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    overrides: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

leadershipTitleSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const LeadershipTitle = model<ILeadershipTitle>('LeadershipTitle', leadershipTitleSchema);
