import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { Domain } from '../models/Domain';
import { ShortLink } from '../models/ShortLink';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const urlsRouter = Router();

urlsRouter.use(authenticate);

urlsRouter.get('/domains', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domains = await Domain.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ domains });
  } catch (err) {
    next(err);
  }
});

urlsRouter.post('/domains', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ hostname: z.string().min(3) }).parse(req.body);
    const domain = await Domain.create({ workspaceId: req.auth!.workspaceId, hostname: body.hostname });
    res.status(201).json({ domain });
  } catch (err) {
    next(err);
  }
});

urlsRouter.post('/domains/:id/verify', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domain = await Domain.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { verified: true } },
      { new: true },
    );
    if (!domain) throw new HttpError(404, 'Domain not found');
    res.json({ domain });
  } catch (err) {
    next(err);
  }
});

urlsRouter.get('/links', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const links = await ShortLink.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    const domainCount = await Domain.countDocuments({ workspaceId: req.auth!.workspaceId });
    res.json({ links, hasDomain: domainCount > 0 });
  } catch (err) {
    next(err);
  }
});

const createLinkSchema = z.object({
  linkType: z.string().optional(),
  redirectMode: z.enum(['301', '302']).optional(),
  destinationUrl: z.string().url(),
  title: z.string().optional(),
  domainId: z.string().min(1),
  slug: z.string().optional(),
  utm: z
    .object({
      source: z.string().optional(),
      medium: z.string().optional(),
      campaign: z.string().optional(),
      term: z.string().optional(),
      content: z.string().optional(),
    })
    .optional(),
  attributionModel: z.string().optional(),
  cookieDurationDays: z.number().optional(),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

urlsRouter.post('/links', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const domainCount = await Domain.countDocuments({ workspaceId: req.auth!.workspaceId });
    if (domainCount === 0) {
      throw new HttpError(400, 'Connect a domain before creating links');
    }

    const body = createLinkSchema.parse(req.body);
    const domain = await Domain.findOne({ _id: body.domainId, workspaceId: req.auth!.workspaceId });
    if (!domain) throw new HttpError(404, 'Domain not found');

    const slug = body.slug ?? crypto.randomBytes(4).toString('hex');
    const link = await ShortLink.create({
      ...body,
      slug,
      workspaceId: req.auth!.workspaceId,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    });
    res.status(201).json({ link, publicUrl: `https://${domain.hostname}/${slug}` });
  } catch (err) {
    next(err);
  }
});

urlsRouter.get('/dashboard', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const [links, domains] = await Promise.all([
      ShortLink.find({ workspaceId: req.auth!.workspaceId }).lean(),
      Domain.find({ workspaceId: req.auth!.workspaceId }).lean(),
    ]);
    const totalClicks = links.reduce((sum, l) => sum + l.clicks, 0);
    const uniqueClicks = links.reduce((sum, l) => sum + l.uniqueClicks, 0);
    res.json({
      kpis: {
        totalLinks: links.length,
        totalClicks,
        uniqueClicks,
        domains: domains.length,
      },
      popularLinks: links.sort((a, b) => b.clicks - a.clicks).slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
});
