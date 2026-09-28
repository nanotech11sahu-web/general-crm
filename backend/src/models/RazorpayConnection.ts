import { Schema, model, Document, Types } from 'mongoose';

export interface IRazorpayConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  connected: boolean;
  accountEmail?: string;
  connectedAt?: Date;
}

const razorpayConnectionSchema = new Schema<IRazorpayConnection>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  connected: { type: Boolean, default: false },
  accountEmail: { type: String },
  connectedAt: { type: Date },
});

export const RazorpayConnection = model<IRazorpayConnection>('RazorpayConnection', razorpayConnectionSchema);
