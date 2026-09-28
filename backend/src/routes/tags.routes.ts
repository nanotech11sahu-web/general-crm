import { Router } from 'express';
import { z } from 'zod';
import { Tag, TAG_OBJECT_TYPES } from '../models/Tag';
import { Contact } from '../models/Contact';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const tagsRouter = Router();

tagsRouter.use(authenticate);

tagsRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const tags = await Tag.find({ workspaceId: req.auth!.workspaceId }).sort({ order: 1, name: 1 }).lean();
    // Usage counts are computed live from real Contact references rather than a stored
    // counter, which would drift out of sync the moment a tag is added/removed elsewhere
    // (the same class of staleness bug found and fixed in Phase 7's AI Brain seeding).
    const counts = await Contact.aggregate([
      { $match: { workspaceId: tags[0]?.workspaceId } },
      { $unwind: '$tagIds' },
      { $group: { _id: '$tagIds', count: { $sum: 1 } } },
    ]);
    const countByTagId = new Map(counts.map((c) => [String(c._id), c.count]));
    res.json({ tags: tags.map((t) => ({ ...t, usageCount: countByTagId.get(String(t._id)) ?? 0 })) });
  } catch (err) {
    next(err);
  }
});

const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  appliesTo: z.array(z.enum(TAG_OBJECT_TYPES)).min(1),
  category: z.string().optional(),
  order: z.number().optional(),
});

tagsRouter.post('/', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createTagSchema.parse(req.body);
    const tag = await Tag.create({ ...body, workspaceId: req.auth!.workspaceId });
    res.status(201).json({ tag });
  } catch (err) {
    next(err);
  }
});

tagsRouter.patch('/:id', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createTagSchema.partial().parse(req.body);
    const tag = await Tag.findOneAndUpdate(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId },
      { $set: body },
      { new: true },
    );
    if (!tag) throw new HttpError(404, 'Tag not found');
    res.json({ tag });
  } catch (err) {
    next(err);
  }
});

tagsRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const tag = await Tag.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!tag) throw new HttpError(404, 'Tag not found');
    await DeletedItem.create({
      workspaceId: req.auth!.workspaceId,
      module: 'settings',
      originalCollection: 'Tag',
      originalId: tag._id,
      snapshot: tag.toObject(),
      deletedBy: req.auth!.userId,
    });
    await tag.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
