import { Router } from 'express';
import { Notification } from '../models/Notification';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const notifications = await Notification.find({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const unreadCount = await Notification.countDocuments({
      workspaceId: req.auth!.workspaceId,
      userId: req.auth!.userId,
      read: false,
    });
    res.json({ notifications, unreadCount });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/read-all', async (req: AuthenticatedRequest, res, next) => {
  try {
    await Notification.updateMany(
      { workspaceId: req.auth!.workspaceId, userId: req.auth!.userId, read: false },
      { $set: { read: true } },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post('/:id/read', async (req: AuthenticatedRequest, res, next) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, workspaceId: req.auth!.workspaceId, userId: req.auth!.userId },
      { $set: { read: true } },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
