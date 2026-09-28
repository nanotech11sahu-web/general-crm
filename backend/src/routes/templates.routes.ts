import { Router } from 'express';
import { z } from 'zod';
import { ContentTemplate, TEMPLATE_CATEGORIES } from '../models/ContentTemplate';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const templatesRouter = Router();

templatesRouter.use(authenticate);

templatesRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (category) filter.category = category;
    const templates = await ContentTemplate.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ templates, categories: TEMPLATE_CATEGORIES });
  } catch (err) {
    next(err);
  }
});

const templateSchema = z.object({ category: z.enum(TEMPLATE_CATEGORIES), name: z.string().min(1), content: z.string().min(1) });

templatesRouter.post('/', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = templateSchema.parse(req.body);
    const template = await ContentTemplate.create({ workspaceId: req.auth!.workspaceId, ...body });
    res.status(201).json({ template });
  } catch (err) {
    next(err);
  }
});

templatesRouter.patch('/:id', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = templateSchema.partial().parse(req.body);
    const template = await ContentTemplate.findOneAndUpdate({ _id: req.params.id, workspaceId: req.auth!.workspaceId }, { $set: body }, { new: true });
    if (!template) throw new HttpError(404, 'Template not found');
    res.json({ template });
  } catch (err) {
    next(err);
  }
});

templatesRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const template = await ContentTemplate.findOneAndDelete({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!template) throw new HttpError(404, 'Template not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default templatesRouter;
