import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { getContactStats } from '../services/contactStats.service';

export const contactStatsRouter = Router();

contactStatsRouter.use(authenticate);

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

contactStatsRouter.get('/', requirePermission('leadManagement', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const query = querySchema.parse(req.query);
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getFullYear(), to.getMonth(), 1);
    const stats = await getContactStats(req.auth!.workspaceId, { from, to });
    res.json(stats);
  } catch (err) {
    next(err);
  }
});
