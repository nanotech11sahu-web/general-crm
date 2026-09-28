import { Router } from 'express';
import { z } from 'zod';
import { ChatWidget } from '../models/ChatWidget';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const chatWidgetsRouter = Router();

chatWidgetsRouter.use(authenticate);

chatWidgetsRouter.get('/', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const widgets = await ChatWidget.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: -1 }).lean();
    res.json({ widgets });
  } catch (err) {
    next(err);
  }
});

const widgetSchema = z.object({
  name: z.string().min(1),
  branding: z.object({ companyName: z.string().min(1), logoUrl: z.string().optional() }).optional(),
  theme: z.object({ primaryColor: z.string().optional(), position: z.enum(['bottom-right', 'bottom-left']).optional() }).optional(),
  preChat: z.object({ greeting: z.string().optional(), collectName: z.boolean().optional(), collectEmail: z.boolean().optional() }).optional(),
  hours: z
    .object({
      alwaysOn: z.boolean().optional(),
      timezone: z.string().optional(),
      schedule: z.array(z.object({ day: z.string(), open: z.string(), close: z.string() })).optional(),
    })
    .optional(),
  routing: z.object({ assignTo: z.enum(['round_robin', 'specific_agent', 'team']).optional(), fallbackMessage: z.string().optional() }).optional(),
});

chatWidgetsRouter.post('/', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = widgetSchema.parse(req.body);
    const exists = await ChatWidget.exists({ workspaceId: req.auth!.workspaceId, name: body.name });
    if (exists) throw new HttpError(400, 'A chat widget with this name already exists');
    const widget = await ChatWidget.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ widget });
  } catch (err) {
    next(err);
  }
});

chatWidgetsRouter.get('/:id', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const widget = await ChatWidget.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).lean();
    if (!widget) throw new HttpError(404, 'Chat widget not found');
    res.json({ widget });
  } catch (err) {
    next(err);
  }
});

chatWidgetsRouter.patch('/:id', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = widgetSchema.partial().parse(req.body);
    const widget = await ChatWidget.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!widget) throw new HttpError(404, 'Chat widget not found');
    if (body.name) widget.name = body.name;
    if (body.branding) Object.assign(widget.branding, body.branding);
    if (body.theme) Object.assign(widget.theme, body.theme);
    if (body.preChat) Object.assign(widget.preChat, body.preChat);
    if (body.hours) Object.assign(widget.hours, body.hours);
    if (body.routing) Object.assign(widget.routing, body.routing);
    await widget.save();
    res.json({ widget });
  } catch (err) {
    next(err);
  }
});

chatWidgetsRouter.post('/:id/activate', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const widget = await ChatWidget.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { status: 'active' } },
      { new: true },
    );
    if (!widget) throw new HttpError(404, 'Chat widget not found');
    res.json({ widget });
  } catch (err) {
    next(err);
  }
});

chatWidgetsRouter.delete('/:id', requirePermission('leadGeneration', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const widget = await ChatWidget.findOneAndDelete({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!widget) throw new HttpError(404, 'Chat widget not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
