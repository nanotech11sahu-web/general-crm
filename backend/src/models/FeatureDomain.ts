import { Schema, model, Document, Types } from 'mongoose';

export const DOMAIN_FEATURES = ['funnel', 'form', 'store', 'community', 'portal'] as const;
export type DomainFeature = (typeof DOMAIN_FEATURES)[number];

export interface IFeatureDomain extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  domainId: Types.ObjectId;
  feature: DomainFeature;
  targetId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const featureDomainSchema = new Schema<IFeatureDomain>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    domainId: { type: Schema.Types.ObjectId, ref: 'Domain', required: true },
    feature: { type: String, enum: DOMAIN_FEATURES, required: true },
    targetId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

featureDomainSchema.index({ workspaceId: 1, feature: 1 }, { unique: true });

export const FeatureDomain = model<IFeatureDomain>('FeatureDomain', featureDomainSchema);
