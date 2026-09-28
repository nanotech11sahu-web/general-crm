import { Schema, model, Document, Types } from 'mongoose';

export const CALL_DIRECTIONS = ['inbound', 'outbound'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

export const CALL_STATUSES = ['completed', 'missed', 'in_progress', 'failed'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export interface ICallLog extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  direction: CallDirection;
  status: CallStatus;
  fromNumber: string;
  toNumber: string;
  agentMembershipId?: Types.ObjectId;
  contactId?: Types.ObjectId;
  pipelineId?: Types.ObjectId;
  source?: string;
  durationSeconds: number;
  recordingUrl?: string;
  createdAt: Date;
}

const callLogSchema = new Schema<ICallLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    direction: { type: String, enum: CALL_DIRECTIONS, required: true },
    status: { type: String, enum: CALL_STATUSES, default: 'in_progress' },
    fromNumber: { type: String, required: true },
    toNumber: { type: String, required: true },
    agentMembershipId: { type: Schema.Types.ObjectId, ref: 'Membership' },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    pipelineId: { type: Schema.Types.ObjectId, ref: 'Pipeline' },
    source: { type: String },
    durationSeconds: { type: Number, default: 0 },
    recordingUrl: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const CallLog = model<ICallLog>('CallLog', callLogSchema);
