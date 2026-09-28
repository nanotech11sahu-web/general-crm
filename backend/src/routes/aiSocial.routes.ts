import { Router } from 'express';
import { z } from 'zod';
import { SocialChannel, SOCIAL_PLATFORMS } from '../models/SocialChannel';
import { SocialPost, SOCIAL_POST_STATUSES } from '../models/SocialPost';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const aiSocialRouter = Router();

aiSocialRouter.use(authenticate);

aiSocialRouter.get('/channels', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const channels = await SocialChannel.find({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ channels });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({ platform: z.enum(SOCIAL_PLATFORMS) });

aiSocialRouter.post('/channels/connect', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = connectSchema.parse(req.body);
    const channel = await SocialChannel.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, platform: body.platform },
      { $set: { status: 'connected', connectedAt: new Date() } },
      { new: true, upsert: true },
    );
    res.json({ channel });
  } catch (err) {
    next(err);
  }
});

aiSocialRouter.get('/dashboard', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const posts = await SocialPost.find({ workspaceId: req.auth!.workspaceId }).lean();
    const channels = await SocialChannel.find({ workspaceId: req.auth!.workspaceId }).lean();

    const funnel = SOCIAL_POST_STATUSES.reduce<Record<string, number>>((acc, status) => {
      acc[status] = posts.filter((p) => p.status === status).length;
      return acc;
    }, {});

    const reach = posts.reduce((sum, p) => sum + p.reach, 0);
    const engagement = posts.reduce((sum, p) => sum + p.engagement, 0);
    const engagementRate = reach > 0 ? Math.round((engagement / reach) * 1000) / 10 : 0;

    res.json({
      kpis: {
        reach,
        engagementRate,
        postsPublished: posts.filter((p) => p.status === 'published').length,
        totalAudience: channels.filter((c) => c.status === 'connected').length,
      },
      deliveryFunnel: funnel,
      connectionHealth: {
        connected: channels.filter((c) => c.status === 'connected').length,
        expiringSoon: channels.filter((c) => c.status === 'expiring_soon').length,
        expired: channels.filter((c) => c.status === 'expired').length,
      },
      channels,
    });
  } catch (err) {
    next(err);
  }
});

const createPostSchema = z.object({
  content: z.string().min(1),
  channels: z.array(z.enum(SOCIAL_PLATFORMS)).min(1),
  mode: z.enum(['draft', 'publish']),
  scheduledAt: z.string().optional(),
});

aiSocialRouter.post('/posts', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createPostSchema.parse(req.body);
    if (body.mode === 'publish') {
      const connectedChannels = await SocialChannel.find({
        workspaceId: req.auth!.workspaceId,
        platform: { $in: body.channels },
        status: 'connected',
      });
      if (connectedChannels.length !== body.channels.length) {
        throw new HttpError(400, 'All selected channels must be connected before posting');
      }
    }

    const status = body.mode === 'draft' ? 'draft' : body.scheduledAt ? 'scheduled' : 'published';
    const post = await SocialPost.create({
      workspaceId: req.auth!.workspaceId,
      content: body.content,
      channels: body.channels,
      status,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      publishedAt: status === 'published' ? new Date() : undefined,
    });
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

aiSocialRouter.get('/posts', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const posts = await SocialPost.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ posts });
  } catch (err) {
    next(err);
  }
});
