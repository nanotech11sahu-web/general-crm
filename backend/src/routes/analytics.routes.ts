import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { computeAnalytics } from '../services/analytics.service';
import { markOnboardingTaskComplete } from '../services/onboarding.service';

export const analyticsRouter = Router();

analyticsRouter.use(authenticate);

analyticsRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const analytics = await computeAnalytics(req.auth!.workspaceId);
    await markOnboardingTaskComplete(req.auth!.workspaceId, 'analytics_reviewed');
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

export default analyticsRouter;
