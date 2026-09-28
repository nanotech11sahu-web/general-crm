import { Router } from 'express';
import { z } from 'zod';
import { BrandingSettings } from '../models/BrandingSettings';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';

export const brandingRouter = Router();

brandingRouter.use(authenticate);

// Deliberately readable by anyone authenticated into the workspace (not gated behind
// requirePermission('settings','read')) — the sidebar itself needs this on every load,
// not just for admins who can edit it.
brandingRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    let branding = await BrandingSettings.findOne({ workspaceId: req.auth!.workspaceId });
    if (!branding) branding = await BrandingSettings.create({ workspaceId: req.auth!.workspaceId });
    res.json({ branding });
  } catch (err) {
    next(err);
  }
});

const brandingSchema = z.object({
  logoLightUrl: z.string().optional(),
  logoDarkUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  loaderText: z.string().optional(),
  mobileNavLocked: z.boolean().optional(),
  experienceName: z.string().optional(),
});

brandingRouter.patch('/', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = brandingSchema.parse(req.body);
    const branding = await BrandingSettings.findOneAndUpdate({ workspaceId: req.auth!.workspaceId }, { $set: body }, { upsert: true, new: true });
    res.json({ branding });
  } catch (err) {
    next(err);
  }
});

export default brandingRouter;
