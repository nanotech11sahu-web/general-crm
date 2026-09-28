import { Schema, model, Document, Types } from 'mongoose';

export interface IContactNote extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  body: string;
  authorId: Types.ObjectId;
  createdAt: Date;
}

const contactNoteSchema = new Schema<IContactNote>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    body: { type: String, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ContactNote = model<IContactNote>('ContactNote', contactNoteSchema);
