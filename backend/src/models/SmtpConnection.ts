import { Schema, model, Document, Types } from 'mongoose';

export interface ISmtpConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  connected: boolean;
  host?: string;
  port?: number;
  username?: string;
  passwordMasked?: string;
  fromEmail?: string;
  connectedAt?: Date;
}

const smtpConnectionSchema = new Schema<ISmtpConnection>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  connected: { type: Boolean, default: false },
  host: { type: String },
  port: { type: Number },
  username: { type: String },
  passwordMasked: { type: String },
  fromEmail: { type: String },
  connectedAt: { type: Date },
});

export const SmtpConnection = model<ISmtpConnection>('SmtpConnection', smtpConnectionSchema);
