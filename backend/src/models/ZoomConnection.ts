import { Schema, model, Document, Types } from 'mongoose';

export interface IZoomConnection extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  connected: boolean;
  accountEmail?: string;
  connectedAt?: Date;
}

const zoomConnectionSchema = new Schema<IZoomConnection>({
  workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, unique: true },
  connected: { type: Boolean, default: false },
  accountEmail: { type: String },
  connectedAt: { type: Date },
});

export const ZoomConnection = model<IZoomConnection>('ZoomConnection', zoomConnectionSchema);
