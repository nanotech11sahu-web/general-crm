import { Schema, model, Document, Types } from 'mongoose';

export interface IChatWidget extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  status: 'draft' | 'active';
  branding: {
    companyName: string;
    logoUrl?: string;
  };
  theme: {
    primaryColor: string;
    position: 'bottom-right' | 'bottom-left';
  };
  preChat: {
    greeting: string;
    collectName: boolean;
    collectEmail: boolean;
  };
  hours: {
    alwaysOn: boolean;
    timezone: string;
    schedule: { day: string; open: string; close: string }[];
  };
  routing: {
    assignTo: 'round_robin' | 'specific_agent' | 'team';
    fallbackMessage: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const chatWidgetSchema = new Schema<IChatWidget>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'active'], default: 'draft' },
    branding: {
      companyName: { type: String, default: '' },
      logoUrl: { type: String },
    },
    theme: {
      primaryColor: { type: String, default: '#4f46e5' },
      position: { type: String, enum: ['bottom-right', 'bottom-left'], default: 'bottom-right' },
    },
    preChat: {
      greeting: { type: String, default: 'Hi there! How can we help?' },
      collectName: { type: Boolean, default: true },
      collectEmail: { type: Boolean, default: true },
    },
    hours: {
      alwaysOn: { type: Boolean, default: true },
      timezone: { type: String, default: 'Asia/Kolkata' },
      schedule: [{ day: String, open: String, close: String, _id: false }],
    },
    routing: {
      assignTo: { type: String, enum: ['round_robin', 'specific_agent', 'team'], default: 'round_robin' },
      fallbackMessage: { type: String, default: "We'll get back to you as soon as possible." },
    },
  },
  { timestamps: true },
);

chatWidgetSchema.index({ workspaceId: 1, name: 1 }, { unique: true });

export const ChatWidget = model<IChatWidget>('ChatWidget', chatWidgetSchema);
