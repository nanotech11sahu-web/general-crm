import { Schema, model, Document, Types } from 'mongoose';

export interface IAgency extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const agencySchema = new Schema<IAgency>(
  {
    name: { type: String, required: true, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);

export const Agency = model<IAgency>('Agency', agencySchema);
