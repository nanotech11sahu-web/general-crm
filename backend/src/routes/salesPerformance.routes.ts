import { Router } from 'express';
import { z } from 'zod';
import { SalesActivity, SALES_ACTIVITY_TYPES } from '../models/SalesActivity';
import { IncentiveSetting } from '../models/IncentiveSetting';
import { Membership } from '../models/Membership';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { buildLeaderboard } from '../services/salesPerformance.service';

export const salesPerformanceRouter = Router();

salesPerformanceRouter.use(authenticate);

salesPerformanceRouter.get('/leaderboard', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const view = req.query.view === 'my' ? [req.auth!.membershipId] : undefined;
    const leaderboard = await buildLeaderboard(req.auth!.workspaceId, view);
    res.json({ leaderboard });
  } catch (err) {
    next(err);
  }
});

salesPerformanceRouter.get('/overview', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const view = req.query.view === 'my' ? [req.auth!.membershipId] : undefined;
    const leaderboard = await buildLeaderboard(req.auth!.workspaceId, view);
    const kpis = leaderboard.reduce(
      (acc, row) => {
        acc.verifiedRevenue += row.verifiedRevenue;
        acc.totalActions += row.totalActions;
        acc.callsMade += row.callsMade;
        acc.activeNow += row.activeNow ? 1 : 0;
        return acc;
      },
      { verifiedRevenue: 0, totalActions: 0, callsMade: 0, activeNow: 0 },
    );
    const responseValues = leaderboard.filter((r) => r.avgResponseSeconds !== null).map((r) => r.avgResponseSeconds as number);
    const avgResponseSeconds = responseValues.length ? responseValues.reduce((s, v) => s + v, 0) / responseValues.length : null;
    res.json({ kpis: { ...kpis, avgResponseSeconds } });
  } catch (err) {
    next(err);
  }
});

const logActivitySchema = z.object({
  type: z.enum(SALES_ACTIVITY_TYPES),
  amount: z.number().optional(),
  responseTimeSeconds: z.number().optional(),
  note: z.string().optional(),
  membershipId: z.string().optional(),
});

salesPerformanceRouter.post('/activities', requirePermission('sales', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = logActivitySchema.parse(req.body);
    const activity = await SalesActivity.create({
      workspaceId: req.auth!.workspaceId,
      membershipId: body.membershipId ?? req.auth!.membershipId,
      type: body.type,
      amount: body.amount,
      responseTimeSeconds: body.responseTimeSeconds,
      note: body.note,
    });
    res.status(201).json({ activity });
  } catch (err) {
    next(err);
  }
});

salesPerformanceRouter.get('/incentive-settings', requirePermission('sales', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const settings = await IncentiveSetting.find({ workspaceId: req.auth!.workspaceId }).lean();
    const memberships = await Membership.find({ workspaceId: req.auth!.workspaceId }).populate('userId', 'name email').lean();
    res.json({ settings, memberships });
  } catch (err) {
    next(err);
  }
});

const incentiveSchema = z.object({ membershipId: z.string(), incentiveAmount: z.number().min(0), notes: z.string().optional() });

salesPerformanceRouter.put('/incentive-settings', requirePermission('sales', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = incentiveSchema.parse(req.body);
    const setting = await IncentiveSetting.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, membershipId: body.membershipId },
      { $set: { incentiveAmount: body.incentiveAmount, notes: body.notes } },
      { upsert: true, new: true },
    );
    res.json({ setting });
  } catch (err) {
    next(err);
  }
});
