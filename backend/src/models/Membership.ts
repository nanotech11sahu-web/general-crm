import { Schema, model, Document, Types } from 'mongoose';

export interface IMembership extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  roleId: Types.ObjectId;
  leadershipTitleIds: Types.ObjectId[];
  status: 'active' | 'invited' | 'suspended';
  dashboardLayout: { key: string; visible: boolean }[];
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<IMembership>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    leadershipTitleIds: [{ type: Schema.Types.ObjectId, ref: 'LeadershipTitle' }],
    status: { type: String, enum: ['active', 'invited', 'suspended'], default: 'active' },
    dashboardLayout: {
      type: [{ key: { type: String, required: true }, visible: { type: Boolean, default: true } }],
      default: [],
      _id: false,
    },
  },
  { timestamps: true },
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });

export const Membership = model<IMembership>('Membership', membershipSchema);
