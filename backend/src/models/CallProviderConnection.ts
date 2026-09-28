import { Schema, model, Document, Types } from 'mongoose';

export interface ICallProviderConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  providerKey: string;
  connected: boolean;
  connectedAt?: Date;
}

const callProviderConnectionSchema = new Schema<ICallProviderConnection>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  providerKey: { type: String, required: true },
  connected: { type: Boolean, default: false },
  connectedAt: { type: Date },
});

callProviderConnectionSchema.index({ workspaceId: 1, providerKey: 1 }, { unique: true });

export const CallProviderConnection = model<ICallProviderConnection>('CallProviderConnection', callProviderConnectionSchema);

export const CALL_PROVIDER_CATALOG = [
  { key: 'callyzer', name: 'Callyzer' },
  { key: 'myoperator', name: 'MyOperator' },
  { key: 'exotel', name: 'Exotel' },
  { key: 'knowlarity', name: 'Knowlarity' },
] as const;
