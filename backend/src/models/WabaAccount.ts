import { Schema, model, Document, Types } from 'mongoose';

export interface IWabaAccount extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  status: 'not_connected' | 'connected';
  onboardingType: 'own_number' | 'coexistence' | null;
  billingMode: 'byob' | 'credit_line' | null;
  qualityRating: 'green' | 'yellow' | 'red' | null;
  tier: string | null;
  messagingLimit: number;
  autoOptOutEnabled: boolean;
  connectedAt?: Date;
}

const wabaAccountSchema = new Schema<IWabaAccount>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true, index: true },
    status: { type: String, enum: ['not_connected', 'connected'], default: 'not_connected' },
    onboardingType: { type: String, enum: ['own_number', 'coexistence', null], default: null },
    billingMode: { type: String, enum: ['byob', 'credit_line', null], default: null },
    qualityRating: { type: String, enum: ['green', 'yellow', 'red', null], default: null },
    tier: { type: String, default: null },
    messagingLimit: { type: Number, default: 0 },
    autoOptOutEnabled: { type: Boolean, default: true },
    connectedAt: { type: Date },
  },
  { timestamps: false },
);

export const WabaAccount = model<IWabaAccount>('WabaAccount', wabaAccountSchema);
