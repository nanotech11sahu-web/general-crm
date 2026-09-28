import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Funnel } from '../models/Funnel';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const funnelsRouter = Router();

funnelsRouter.use(authenticate);

funnelsRouter.get('/', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const funnels = await Funnel.find({ workspaceId: req.auth!.workspaceId, archived: false }).sort({ createdAt: -1 }).lean();
    res.json({ funnels });
  } catch (err) {
    next(err);
  }
});

const createFunnelSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
});

funnelsRouter.post('/', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createFunnelSchema.parse(req.body);
    const homePageId = crypto.randomBytes(6).toString('hex');
    const funnel = await Funnel.create({
      ...body,
      workspaceId: req.auth!.workspaceId,
      pages: [{ id: homePageId, name: 'Home', path: '/', isHome: true, status: 'draft', blocks: [] }],
    });
    res.status(201).json({ funnel });
  } catch (err) {
    next(err);
  }
});

funnelsRouter.get('/:id', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    res.json({ funnel });
  } catch (err) {
    next(err);
  }
});

const updateFunnelSchema = z.object({
  name: z.string().min(1).optional(),
  isOnline: z.boolean().optional(),
  settings: z
    .object({
      domain: z.string().optional(),
      favicon: z.string().optional(),
      trackingHeader: z.string().optional(),
      trackingBody: z.string().optional(),
      robotsTxtEnabled: z.boolean().optional(),
      sitemapEnabled: z.boolean().optional(),
    })
    .partial()
    .optional(),
});

funnelsRouter.patch('/:id', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateFunnelSchema.parse(req.body);
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    if (body.name) funnel.name = body.name;
    if (typeof body.isOnline === 'boolean') funnel.isOnline = body.isOnline;
    if (body.settings) Object.assign(funnel.settings, body.settings);
    await funnel.save();
    res.json({ funnel });
  } catch (err) {
    next(err);
  }
});

funnelsRouter.delete('/:id', requirePermission('leadGeneration', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'leadGeneration',
      originalCollection: 'Funnel',
      originalId: funnel._id,
      snapshot: funnel.toObject(),
      deletedBy: req.auth!.userId,
    });
    await funnel.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const pageBlockSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['heading', 'text', 'image', 'cta', 'divider']),
  content: z.string().default(''),
  href: z.string().optional(),
});

const updatePageSchema = z.object({
  name: z.string().optional(),
  blocks: z.array(pageBlockSchema).optional(),
});

funnelsRouter.post('/:id/pages', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1), path: z.string().min(1) }).parse(req.body);
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    if (funnel.pages.some((p) => p.path === body.path)) {
      throw new HttpError(400, 'A page with this path already exists');
    }
    funnel.pages.push({ id: crypto.randomBytes(6).toString('hex'), name: body.name, path: body.path, isHome: false, status: 'draft', blocks: [] });
    await funnel.save();
    res.status(201).json({ funnel });
  } catch (err) {
    next(err);
  }
});

funnelsRouter.patch('/:id/pages/:pageId', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updatePageSchema.parse(req.body);
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    const page = funnel.pages.find((p) => p.id === req.params.pageId);
    if (!page) throw new HttpError(404, 'Page not found');
    if (body.name) page.name = body.name;
    if (body.blocks) {
      page.blocks = body.blocks.map((b) => ({ ...b, id: b.id ?? crypto.randomBytes(6).toString('hex') }));
    }
    await funnel.save();
    res.json({ funnel });
  } catch (err) {
    next(err);
  }
});

funnelsRouter.post('/:id/pages/:pageId/publish', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const funnel = await Funnel.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!funnel) throw new HttpError(404, 'Funnel not found');
    const page = funnel.pages.find((p) => p.id === req.params.pageId);
    if (!page) throw new HttpError(404, 'Page not found');
    if (page.blocks.length === 0) throw new HttpError(400, 'Cannot publish an empty page');
    page.status = 'active';
    funnel.publishedAt = new Date();
    await funnel.save();
    res.json({ funnel });
  } catch (err) {
    next(err);
  }
});
