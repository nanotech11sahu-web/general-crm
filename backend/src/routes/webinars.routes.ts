import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { Webinar, WEBINAR_STATUSES } from '../models/Webinar';
import { ZoomConnection } from '../models/ZoomConnection';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const webinarsRouter = Router();

webinarsRouter.use(authenticate);

webinarsRouter.get('/zoom-status', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const zoom = await ZoomConnection.findOne({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ connected: zoom?.connected ?? false, accountEmail: zoom?.accountEmail });
  } catch (err) {
    next(err);
  }
});

webinarsRouter.post('/zoom-connect', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const zoom = await ZoomConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId },
      { $set: { connected: true, accountEmail: `${req.auth!.userId}@zoom.stub`, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ connected: zoom.connected, accountEmail: zoom.accountEmail });
  } catch (err) {
    next(err);
  }
});

webinarsRouter.get('/', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query: Record<string, unknown> = { workspaceId: req.auth!.workspaceId, archived: false };
    if (req.query.status) query.status = req.query.status;
    const webinars = await Webinar.find(query).sort({ startAt: -1 }).lean();
    res.json({ webinars });
  } catch (err) {
    next(err);
  }
});

const optionsSchema = z.object({
  requireRegistration: z.boolean().optional(),
  restrictToRegistered: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
  enableQnA: z.boolean().optional(),
  enablePolls: z.boolean().optional(),
  enableChat: z.boolean().optional(),
  altHostEmails: z.array(z.string()).optional(),
});

const registrationSchema = z.object({
  mode: z.enum(['built_in', 'site_funnel', 'external']).optional(),
  externalUrl: z.string().optional(),
  funnelId: z.string().optional(),
});

const webinarSchema = z.object({
  topic: z.string().min(1),
  description: z.string().optional(),
  coverImage: z.string().optional(),
  scheduleType: z.enum(['one_time', 'recurring']).optional(),
  startAt: z.string(),
  durationMinutes: z.number().min(1).optional(),
  timezone: z.string().optional(),
  recurrence: z.string().optional(),
  options: optionsSchema.optional(),
  registration: registrationSchema.optional(),
});

webinarsRouter.post('/', requirePermission('sales', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = webinarSchema.parse(req.body);
    const webinar = await Webinar.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      startAt: new Date(body.startAt),
      joinLink: `https://meet.pmc-demo.local/w/${crypto.randomBytes(5).toString('hex')}`,
    });
    res.status(201).json({ webinar });
  } catch (err) {
    next(err);
  }
});

webinarsRouter.get('/:id', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const webinar = await Webinar.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!webinar) throw new HttpError(404, 'Webinar not found');
    res.json({ webinar });
  } catch (err) {
    next(err);
  }
});

const updateWebinarSchema = webinarSchema.partial().extend({ status: z.enum(WEBINAR_STATUSES).optional() });

webinarsRouter.patch('/:id', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateWebinarSchema.parse(req.body);
    const webinar = await Webinar.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!webinar) throw new HttpError(404, 'Webinar not found');
    Object.assign(webinar, { ...body, startAt: body.startAt ? new Date(body.startAt) : webinar.startAt });
    await webinar.save();
    res.json({ webinar });
  } catch (err) {
    next(err);
  }
});

webinarsRouter.delete('/:id', requirePermission('sales', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const webinar = await Webinar.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!webinar) throw new HttpError(404, 'Webinar not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'sales',
      originalCollection: 'Webinar',
      originalId: webinar._id,
      snapshot: webinar.toObject(),
      deletedBy: req.auth!.userId,
    });
    await webinar.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
