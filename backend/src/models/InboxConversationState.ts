import { Schema, model, Document, Types } from 'mongoose';

export interface IInboxConversationState extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  starred: boolean;
  snoozedUntil?: Date;
  lastReadAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const inboxConversationStateSchema = new Schema<IInboxConversationState>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    starred: { type: Boolean, default: false },
    snoozedUntil: { type: Date },
    lastReadAt: { type: Date },
  },
  { timestamps: true },
);

inboxConversationStateSchema.index({ workspaceId: 1, contactId: 1 }, { unique: true });

export const InboxConversationState = model<IInboxConversationState>('InboxConversationState', inboxConversationStateSchema);
