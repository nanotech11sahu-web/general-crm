import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { Project, PROJECT_STATUSES, PROJECT_PRIORITIES } from '../models/Project';

export const projectsRouter = Router();

projectsRouter.use(authenticate);

projectsRouter.get('/', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId, archived: false };
    if (req.query.status && PROJECT_STATUSES.includes(req.query.status as (typeof PROJECT_STATUSES)[number])) {
      filter.status = req.query.status;
    }
    if (req.query.contactId) filter.contactId = req.query.contactId;
    if (req.query.assigneeId) filter.assigneeId = req.query.assigneeId;
    const projects = await Project.find(filter).sort({ createdAt: -1 }).populate('contactId', 'name email').lean();
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  contactId: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PROJECT_PRIORITIES).optional(),
  category: z.string().optional(),
  assigneeId: z.string().optional(),
  deadline: z.string().optional(),
  dueTime: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
});

projectsRouter.post('/', requirePermission('operations', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const project = await Project.create({
      workspaceId: req.auth!.workspaceId,
      ...body,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
    });
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

projectsRouter.get('/:id', requirePermission('operations', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId }).populate('contactId', 'name email').lean();
    if (!project) throw new HttpError(404, 'Project not found');
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

const updateSchema = createSchema.partial();

projectsRouter.patch('/:id', requirePermission('operations', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { ...body, deadline: body.deadline ? new Date(body.deadline) : undefined } },
      { new: true },
    );
    if (!project) throw new HttpError(404, 'Project not found');
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

projectsRouter.delete('/:id', requirePermission('operations', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: { archived: true } },
      { new: true },
    );
    if (!project) throw new HttpError(404, 'Project not found');
    res.json({ project });
  } catch (err) {
    next(err);
  }
});

export default projectsRouter;
