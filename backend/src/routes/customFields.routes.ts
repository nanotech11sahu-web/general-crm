import { Router } from 'express';
import { z } from 'zod';
import { CustomField, CUSTOM_FIELD_TYPES } from '../models/CustomField';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const customFieldsRouter = Router();

customFieldsRouter.use(authenticate);

customFieldsRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const objectType = typeof req.query.objectType === 'string' ? req.query.objectType : undefined;
    const filter: Record<string, unknown> = { workspaceId: req.auth!.workspaceId };
    if (objectType) filter.objectType = objectType;
    const fields = await CustomField.find(filter).sort({ order: 1 }).lean();
    res.json({ fields });
  } catch (err) {
    next(err);
  }
});

const createFieldSchema = z.object({
  objectType: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  folder: z.string().optional(),
  order: z.number().optional(),
});

customFieldsRouter.post('/', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createFieldSchema.parse(req.body);
    const field = await CustomField.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ field });
  } catch (err) {
    next(err);
  }
});

customFieldsRouter.patch('/:id', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createFieldSchema.partial().parse(req.body);
    const field = await CustomField.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: body },
      { new: true },
    );
    if (!field) throw new HttpError(404, 'Custom field not found');
    res.json({ field });
  } catch (err) {
    next(err);
  }
});

customFieldsRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const field = await CustomField.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!field) throw new HttpError(404, 'Custom field not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'settings',
      originalCollection: 'CustomField',
      originalId: field._id,
      snapshot: field.toObject(),
      deletedBy: req.auth!.userId,
    });
    await field.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
