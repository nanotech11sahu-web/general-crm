import { Schema, model, Document, Types } from 'mongoose';

export interface ILeadScoreSignal {
  key: string;
  label: string;
  weight: number;
}

export interface ILeadScoreLog extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  contactId: Types.ObjectId;
  score: number;
  signals: ILeadScoreSignal[];
  createdAt: Date;
}

const signalSchema = new Schema<ILeadScoreSignal>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
);

const leadScoreLogSchema = new Schema<ILeadScoreLog>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
    score: { type: Number, required: true },
    signals: { type: [signalSchema], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const LeadScoreLog = model<ILeadScoreLog>('LeadScoreLog', leadScoreLogSchema);
