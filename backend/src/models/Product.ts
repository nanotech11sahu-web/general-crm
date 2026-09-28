import { Schema, model, Document, Types } from 'mongoose';

export const PRODUCT_SOURCES = ['ecom', 'community', 'store'] as const;
export type ProductSource = (typeof PRODUCT_SOURCES)[number];

export interface IProduct extends Document {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  name: string;
  description?: string;
  source: ProductSource;
  salePrice: number;
  currency: string;
  mrp?: number;
  costPrice?: number;
  taxProfileId?: Types.ObjectId;
  taxInclusive: boolean;
  sku?: string;
  barcode?: string;
  collectionId?: Types.ObjectId;
  images: string[];
  seoSlug: string;
  visibility: 'draft' | 'published';
  stockTracking: boolean;
  stockQuantity?: number;
  featured: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    source: { type: String, enum: PRODUCT_SOURCES, default: 'ecom' },
    salePrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    mrp: { type: Number },
    costPrice: { type: Number },
    taxProfileId: { type: Schema.Types.ObjectId, ref: 'TaxProfile' },
    taxInclusive: { type: Boolean, default: false },
    sku: { type: String },
    barcode: { type: String },
    collectionId: { type: Schema.Types.ObjectId, ref: 'Collection' },
    images: [{ type: String }],
    seoSlug: { type: String, required: true },
    visibility: { type: String, enum: ['draft', 'published'], default: 'draft' },
    stockTracking: { type: Boolean, default: false },
    stockQuantity: { type: Number },
    featured: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

productSchema.index({ workspaceId: 1, seoSlug: 1 }, { unique: true });

export const Product = model<IProduct>('Product', productSchema);
