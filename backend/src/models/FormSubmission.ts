import { Schema, model, Document, Types } from 'mongoose';

export interface IFormSubmission extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  formId: Types.ObjectId;
  contactId?: Types.ObjectId;
  data: Record<string, unknown>;
  meta: {
    ip?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    referrer?: string;
    userAgent?: string;
  };
  createdAt: Date;
}

const formSubmissionSchema = new Schema<IFormSubmission>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    formId: { type: Schema.Types.ObjectId, ref: 'Form', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact' },
    data: { type: Schema.Types.Mixed, default: {} },
    meta: {
      ip: String,
      utmSource: String,
      utmMedium: String,
      utmCampaign: String,
      referrer: String,
      userAgent: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const FormSubmission = model<IFormSubmission>('FormSubmission', formSubmissionSchema);
