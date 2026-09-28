import { Schema, model, Document, Types } from 'mongoose';

export const LEAD_IMPORT_SOURCES = [
  'csv',
  'google_sheets',
  'facebook_lead_ads',
  'instagram_lead_ads',
  'website_forms',
  'other_crm',
  'custom',
] as const;
export type LeadImportSourceKey = (typeof LEAD_IMPORT_SOURCES)[number];

export const LEAD_IMPORT_STATUSES = ['completed', 'failed'] as const;
export type LeadImportStatus = (typeof LEAD_IMPORT_STATUSES)[number];

export interface ILeadImportRowError {
  row: number;
  message: string;
}

export interface ILeadImportJob extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  source: LeadImportSourceKey;
  label: string;
  fileName?: string;
  status: LeadImportStatus;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  rowErrors: ILeadImportRowError[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const rowErrorSchema = new Schema<ILeadImportRowError>({ row: Number, message: String }, { _id: false });

const leadImportJobSchema = new Schema<ILeadImportJob>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    source: { type: String, enum: LEAD_IMPORT_SOURCES, required: true },
    label: { type: String, required: true },
    fileName: { type: String },
    status: { type: String, enum: LEAD_IMPORT_STATUSES, default: 'completed' },
    totalRows: { type: Number, default: 0 },
    createdCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    rowErrors: { type: [rowErrorSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

leadImportJobSchema.index({ workspaceId: 1, createdAt: -1 });

export const LeadImportJob = model<ILeadImportJob>('LeadImportJob', leadImportJobSchema);
