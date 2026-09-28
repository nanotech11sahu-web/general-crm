import { Router } from 'express';
import { z } from 'zod';
import { Pipeline } from '../models/Pipeline';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const pipelinesRouter = Router();

pipelinesRouter.use(authenticate);

pipelinesRouter.get('/', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const pipelines = await Pipeline.find({ workspaceId: req.auth!.workspaceId }).sort({ createdAt: 1 }).lean();
    res.json({ pipelines });
  } catch (err) {
    next(err);
  }
});

const stageSchema = z.object({ key: z.string().min(1), label: z.string().min(1), order: z.number() });
const createPipelineSchema = z.object({
  name: z.string().min(1),
  stages: z.array(stageSchema).min(1),
});

pipelinesRouter.post('/', requirePermission('leadManagement', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createPipelineSchema.parse(req.body);
    const pipeline = await Pipeline.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ pipeline });
  } catch (err) {
    next(err);
  }
});

pipelinesRouter.patch('/:id', requirePermission('leadManagement', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createPipelineSchema.partial().parse(req.body);
    const pipeline = await Pipeline.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: body },
      { new: true },
    );
    if (!pipeline) throw new HttpError(404, 'Pipeline not found');
    res.json({ pipeline });
  } catch (err) {
    next(err);
  }
});

pipelinesRouter.delete('/:id', requirePermission('leadManagement', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const pipeline = await Pipeline.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!pipeline) throw new HttpError(404, 'Pipeline not found');
    if (pipeline.isDefault) throw new HttpError(400, 'Cannot delete the default pipeline');
    await pipeline.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
