import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { computeDashboardKpis } from '../services/dashboard.service';
import { Membership } from '../models/Membership';
import { Workspace } from '../models/Workspace';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

dashboardRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : startOfMonth(now);
    const to = req.query.to ? new Date(String(req.query.to)) : now;
    const staffMembershipId = req.query.staffMembershipId ? String(req.query.staffMembershipId) : undefined;

    const workspace = await Workspace.findById(req.auth!.workspaceId).select('timezone').lean();
    const groups = await computeDashboardKpis(req.auth!.workspaceId, { from, to, staffMembershipId });

    res.json({ groups, range: { from, to }, timezone: workspace?.timezone ?? 'Asia/Kolkata' });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get('/staff', async (req: AuthenticatedRequest, res, next) => {
  try {
    const memberships = await Membership.find({ workspaceId: req.auth!.workspaceId, status: 'active' })
      .populate('userId', 'name email')
      .select('userId')
      .lean();
    res.json({ staff: memberships });
  } catch (err) {
    next(err);
  }
});

const layoutSchema = z.object({
  layout: z.array(z.object({ key: z.string().min(1), visible: z.boolean() })),
});

dashboardRouter.get('/layout', async (req: AuthenticatedRequest, res, next) => {
  try {
    const membership = await Membership.findById(req.auth!.membershipId).select('dashboardLayout').lean();
    res.json({ layout: membership?.dashboardLayout ?? [] });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.put('/layout', async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = layoutSchema.parse(req.body);
    const membership = await Membership.findByIdAndUpdate(
      req.auth!.membershipId,
      { $set: { dashboardLayout: body.layout } },
      { new: true },
    ).select('dashboardLayout');
    res.json({ layout: membership?.dashboardLayout ?? [] });
  } catch (err) {
    next(err);
  }
});
