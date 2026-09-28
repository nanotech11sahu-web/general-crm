import { Router } from 'express';
import { z } from 'zod';
import { Product } from '../models/Product';
import { Collection } from '../models/Collection';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { callGateway } from '../services/aiGateway.service';

export const ecomRouter = Router();

ecomRouter.use(authenticate);

const FREE_TIER_PRODUCT_LIMIT = 10;

interface StoreBuilderSuggestion {
  storeName: string;
  tagline: string;
  suggestedCollections: string[];
  suggestedProducts: { name: string; priceHint: number }[];
  seoSlug: string;
}

const aiStoreBuilderSchema = z.object({ prompt: z.string().min(1) });

ecomRouter.post('/ai-store-builder', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = aiStoreBuilderSchema.parse(req.body);
    const result = await callGateway({ workspaceId: req.auth!.workspaceId, purpose: 'storeBuilder', prompt: body.prompt });
    const suggestion = JSON.parse(result.content) as StoreBuilderSuggestion;
    res.json({ suggestion });
  } catch (err) {
    next(err);
  }
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'product'
  );
}

ecomRouter.get('/products', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const products = await Product.find({ workspaceId: req.auth!.workspaceId, source: 'ecom', archived: false })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ products, quota: { used: products.length, limit: FREE_TIER_PRODUCT_LIMIT } });
  } catch (err) {
    next(err);
  }
});

const createProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  salePrice: z.number().min(0),
  mrp: z.number().optional(),
  costPrice: z.number().optional(),
  currency: z.string().optional(),
  taxProfileId: z.string().optional(),
  taxInclusive: z.boolean().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  collectionId: z.string().optional(),
  images: z.array(z.string()).max(10).optional(),
  visibility: z.enum(['draft', 'published']).optional(),
  stockTracking: z.boolean().optional(),
  stockQuantity: z.number().optional(),
  featured: z.boolean().optional(),
});

ecomRouter.post('/products', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createProductSchema.parse(req.body);
    const count = await Product.countDocuments({ workspaceId: req.auth!.workspaceId, source: 'ecom', archived: false });
    if (count >= FREE_TIER_PRODUCT_LIMIT) {
      throw new HttpError(402, `Free tier limit of ${FREE_TIER_PRODUCT_LIMIT} products reached. Upgrade to add more.`);
    }

    const baseSlug = slugify(body.name);
    let seoSlug = baseSlug;
    let suffix = 1;
    while (await Product.exists({ workspaceId: req.auth!.workspaceId, seoSlug })) {
      seoSlug = `${baseSlug}-${++suffix}`;
    }

    const product = await Product.create({
      ...body,
      workspaceId: req.auth!.workspaceId,
      source: 'ecom',
      seoSlug,
    });

    // Product IS the shared Finance object — creating it here is the sync, by construction.
    res.status(201).json({ product, financeSynced: true });
  } catch (err) {
    next(err);
  }
});

ecomRouter.get('/products/:id', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

const updateProductSchema = createProductSchema.partial();

ecomRouter.patch('/products/:id', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateProductSchema.parse(req.body);
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: body },
      { new: true },
    );
    if (!product) throw new HttpError(404, 'Product not found');
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

ecomRouter.delete('/products/:id', requirePermission('leadGeneration', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!product) throw new HttpError(404, 'Product not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadGeneration',
      originalCollection: 'Product',
      originalId: product._id,
      snapshot: product.toObject(),
      deletedBy: req.auth!.userId,
    });
    await product.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

ecomRouter.get('/collections', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const collections = await Collection.find({ workspaceId: req.auth!.workspaceId }).sort({ name: 1 }).lean();
    res.json({ collections });
  } catch (err) {
    next(err);
  }
});

ecomRouter.post('/collections', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const collection = await Collection.create({ workspaceId: req.auth!.workspaceId, name: body.name, slug: slugify(body.name) });
    res.status(201).json({ collection });
  } catch (err) {
    next(err);
  }
});

// Tax profiles now live under Settings → Finance → Tax (Phase 6); see financeRouter's /finance/tax-profiles.
