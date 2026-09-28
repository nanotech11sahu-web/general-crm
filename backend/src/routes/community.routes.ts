import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { Course } from '../models/Course';
import { Enrollment } from '../models/Enrollment';
import { Product } from '../models/Product';
import { Coupon } from '../models/Coupon';
import { CommunityOrder } from '../models/CommunityOrder';
import { CommunityProfile, PORTAL_MODULE_KEYS } from '../models/CommunityProfile';
import { purchaseCourse, computeCommunityDashboard } from '../services/community.service';
import { recordOneTimeTransaction } from '../services/finance.service';

export const communityRouter = Router();

communityRouter.use(authenticate);

communityRouter.get('/dashboard', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const dashboard = await computeCommunityDashboard(req.auth!.workspaceId);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

// --- Courses ---
communityRouter.get('/courses', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const courses = await Course.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ courses });
  } catch (err) {
    next(err);
  }
});

const createCourseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1),
  status: z.enum(['draft', 'published']).optional(),
  productId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});

communityRouter.post('/courses', requirePermission('community', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createCourseSchema.parse(req.body);
    const course = await Course.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ course });
  } catch (err) {
    next(err);
  }
});

communityRouter.patch('/courses/:id', requirePermission('community', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createCourseSchema.partial().parse(req.body);
    const course = await Course.findOneAndUpdate({ _id: req.params.id, workspaceId: req.auth!.workspaceId }, { $set: body }, { new: true });
    if (!course) throw new HttpError(404, 'Course not found');
    res.json({ course });
  } catch (err) {
    next(err);
  }
});

const purchaseSchema = z.object({ contactId: z.string().min(1) });

communityRouter.post('/courses/:id/purchase', requirePermission('community', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = purchaseSchema.parse(req.body);
    const enrollment = await purchaseCourse(req.auth!.workspaceId, body.contactId, req.params.id);
    res.status(201).json({ enrollment });
  } catch (err) {
    next(err);
  }
});

communityRouter.get('/courses/:id/enrollments', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const enrollments = await Enrollment.find({ workspaceId: req.auth!.workspaceId, courseId: req.params.id }).lean();
    res.json({ enrollments });
  } catch (err) {
    next(err);
  }
});

communityRouter.get('/contacts/:contactId/enrollments', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const enrollments = await Enrollment.find({ workspaceId: req.auth!.workspaceId, contactId: req.params.contactId }).populate('courseId', 'name').lean();
    res.json({ enrollments });
  } catch (err) {
    next(err);
  }
});

// --- Digital Store ---
communityRouter.get('/store/products', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const products = await Product.find({ workspaceId: req.auth!.workspaceId, source: 'community', archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

const createStoreProductSchema = z.object({ name: z.string().min(1), salePrice: z.number().min(0), description: z.string().optional() });

communityRouter.post('/store/products', requirePermission('community', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createStoreProductSchema.parse(req.body);
    const product = await Product.create({
      workspaceId: req.auth!.workspaceId,
      source: 'community',
      seoSlug: body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      visibility: 'published',
      ...body,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
});

communityRouter.get('/store/coupons', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const coupons = await Coupon.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ coupons });
  } catch (err) {
    next(err);
  }
});

const couponSchema = z.object({ code: z.string().min(1), discountPercent: z.number().min(0).max(100) });

communityRouter.post('/store/coupons', requirePermission('community', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = couponSchema.parse(req.body);
    const coupon = await Coupon.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ coupon });
  } catch (err) {
    next(err);
  }
});

communityRouter.get('/store/orders', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const orders = await CommunityOrder.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

const orderSchema = z.object({ contactId: z.string().min(1), productId: z.string().min(1), couponCode: z.string().optional() });

communityRouter.post('/store/orders', requirePermission('community', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = orderSchema.parse(req.body);
    const product = await Product.findOne({ _id: body.productId, workspaceId: req.auth!.workspaceId });
    if (!product) throw new HttpError(404, 'Product not found');

    let amount = product.salePrice;
    if (body.couponCode) {
      const coupon = await Coupon.findOneAndUpdate(
        { workspaceId: req.auth!.workspaceId, code: body.couponCode.toUpperCase(), active: true },
        { $inc: { redemptions: 1 } },
        { new: true },
      );
      if (coupon) amount = Math.round(amount * (1 - coupon.discountPercent / 100));
    }

    const transaction = await recordOneTimeTransaction({ workspaceId: req.auth!.workspaceId, contactId: body.contactId, productId: body.productId, amount, method: 'manual' });
    const order = await CommunityOrder.create({
      workspaceId: req.auth!.workspaceId,
      contactId: body.contactId,
      productId: body.productId,
      amount,
      couponCode: body.couponCode,
      transactionId: transaction._id,
    });
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

// --- Community Profile settings ---
communityRouter.get('/profile', requirePermission('community', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    let profile = await CommunityProfile.findOne({ workspaceId: req.auth!.workspaceId });
    if (!profile) profile = await CommunityProfile.create({ workspaceId: req.auth!.workspaceId });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

const profileSchema = z.object({
  identity: z.object({ name: z.string().min(1), tagline: z.string().optional() }).optional(),
  images: z.object({ logoUrl: z.string().optional(), bannerUrl: z.string().optional(), loginBannerUrl: z.string().optional(), faviconUrl: z.string().optional() }).optional(),
  portalModules: z.array(z.object({ key: z.enum(PORTAL_MODULE_KEYS), enabled: z.boolean() })).optional(),
  defaultLandingModule: z.enum(PORTAL_MODULE_KEYS).optional(),
  advanced: z.object({ seoTitle: z.string().optional(), seoDescription: z.string().optional(), customScripts: z.string().optional() }).optional(),
});

communityRouter.patch('/profile', requirePermission('community', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = profileSchema.parse(req.body);
    const profile = await CommunityProfile.findOneAndUpdate({ workspaceId: req.auth!.workspaceId }, { $set: body }, { upsert: true, new: true });
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

export default communityRouter;
