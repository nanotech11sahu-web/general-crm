import { Router } from 'express';
import { z } from 'zod';
import { AdAccount, AD_PLATFORMS } from '../models/AdAccount';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { getAdOverview } from '../services/adLauncher.service';

export const adLauncherRouter = Router();

adLauncherRouter.use(authenticate);

adLauncherRouter.get('/accounts', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const accounts = await AdAccount.find({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({ platform: z.enum(AD_PLATFORMS) });

adLauncherRouter.post('/accounts/connect', requirePermission('leadGeneration', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = connectSchema.parse(req.body);
    const account = await AdAccount.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, platform: body.platform },
      {
        $set: {
          status: 'connected',
          connectedAt: new Date(),
          externalAccountId: `mock-${body.platform}-${Date.now()}`,
        },
      },
      { new: true, upsert: true },
    );
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

adLauncherRouter.post('/accounts/:platform/disconnect', requirePermission('leadGeneration', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const account = await AdAccount.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, platform: req.params.platform },
      { $set: { status: 'not_connected' }, $unset: { externalAccountId: '', connectedAt: '' } },
      { new: true },
    );
    if (!account) throw new HttpError(404, 'Ad account not found');
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

adLauncherRouter.get('/overview', requirePermission('leadGeneration', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const overview = await getAdOverview(req.auth!.workspaceId);
    res.json(overview);
  } catch (err) {
    next(err);
  }
});
