import { Schema, model, Document, Types } from 'mongoose';

export interface IVibeProspect {
  id: string;
  name: string;
  company: string;
  city: string;
  title: string;
  saved: boolean;
}

export interface IVibeSearch extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  query: string;
  results: IVibeProspect[];
  creditsSpent: number;
  createdAt: Date;
}

const prospectSchema = new Schema<IVibeProspect>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    company: { type: String, required: true },
    city: { type: String, required: true },
    title: { type: String, required: true },
    saved: { type: Boolean, default: false },
  },
  { _id: false },
);

const vibeSearchSchema = new Schema<IVibeSearch>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    query: { type: String, required: true },
    results: { type: [prospectSchema], default: [] },
    creditsSpent: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const VibeSearch = model<IVibeSearch>('VibeSearch', vibeSearchSchema);
