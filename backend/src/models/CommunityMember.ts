import { Schema, model, Document, Types } from 'mongoose';

export interface ICommunityMember extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  xp: number;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const communityMemberSchema = new Schema<ICommunityMember>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    xp: { type: Number, default: 0 },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

communityMemberSchema.index({ workspaceId: 1, contactId: 1 }, { unique: true });

export const CommunityMember = model<ICommunityMember>('CommunityMember', communityMemberSchema);
