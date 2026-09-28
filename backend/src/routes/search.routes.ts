import { Router } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { globalSearch } from '../services/search.service';

export const searchRouter = Router();

searchRouter.use(authenticate);

searchRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const q = String(req.query.q ?? '');
    const results = await globalSearch(req.auth!.workspaceId, q);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});
