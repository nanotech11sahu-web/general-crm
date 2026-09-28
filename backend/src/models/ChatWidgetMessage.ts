import { Schema, model, Document, Types } from 'mongoose';

export const CHAT_WIDGET_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export type ChatWidgetMessageDirection = (typeof CHAT_WIDGET_MESSAGE_DIRECTIONS)[number];

export interface IChatWidgetMessage extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  chatWidgetId?: Types.ObjectId;
  direction: ChatWidgetMessageDirection;
  message: string;
  createdAt: Date;
}

const chatWidgetMessageSchema = new Schema<IChatWidgetMessage>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    chatWidgetId: { type: Schema.Types.ObjectId, ref: 'ChatWidget' },
    direction: { type: String, enum: CHAT_WIDGET_MESSAGE_DIRECTIONS, required: true },
    message: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const ChatWidgetMessage = model<IChatWidgetMessage>('ChatWidgetMessage', chatWidgetMessageSchema);
