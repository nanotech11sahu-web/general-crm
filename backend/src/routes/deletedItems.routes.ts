import { Router } from 'express';
import mongoose from 'mongoose';
import { DeletedItem } from '../models/DeletedItem';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const deletedItemsRouter = Router();

deletedItemsRouter.use(authenticate);

deletedItemsRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const items = await DeletedItem.find({ workspaceId: req.auth!.workspaceId, restored: false })
      .sort({ deletedAt: -1 })
      .lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

deletedItemsRouter.post('/:id/restore', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const item = await DeletedItem.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!item) throw new HttpError(404, 'Deleted item not found');
    if (item.restored) throw new HttpError(400, 'Item already restored');

    // Generic restore: every module snapshots the full document before deleting, so
    // re-inserting that snapshot into its original collection genuinely brings it back
    // rather than just flagging a "restored" bit with no real effect.
    if (!mongoose.models[item.originalCollection]) throw new HttpError(400, `Unknown collection: ${item.originalCollection}`);
    const Model = mongoose.model(item.originalCollection);
    await Model.create(item.snapshot);

    item.restored = true;
    await item.save();
    res.json({ item });
  } catch (err) {
    next(err);
  }
});

deletedItemsRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const item = await DeletedItem.findOneAndDelete({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!item) throw new HttpError(404, 'Deleted item not found');
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
