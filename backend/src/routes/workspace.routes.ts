import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Workspace } from '../models/Workspace';
import { User } from '../models/User';
import { Membership } from '../models/Membership';
import { Role } from '../models/Role';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { recomputeOnboardingProgress } from '../services/onboarding.service';

export const workspaceRouter = Router();

workspaceRouter.get('/current', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspace = await Workspace.findById(req.auth!.workspaceId).lean();
    if (!workspace) throw new HttpError(404, 'Workspace not found');
    res.json({ workspace });
  } catch (err) {
    next(err);
  }
});

workspaceRouter.get('/onboarding', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const progress = await recomputeOnboardingProgress(req.auth!.workspaceId);
    res.json(progress);
  } catch (err) {
    next(err);
  }
});

// --- Staff: workspace members (login accounts + role assignment) ---
workspaceRouter.get('/members', authenticate, requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const memberships = await Membership.find({ workspaceId: req.auth!.workspaceId }).populate('userId', 'name email').populate('roleId', 'name').lean();
    res.json({ members: memberships });
  } catch (err) {
    next(err);
  }
});

const inviteSchema = z.object({ name: z.string().min(1), email: z.string().email(), roleId: z.string().min(1) });

workspaceRouter.post('/members/invite', authenticate, requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = inviteSchema.parse(req.body);
    const role = await Role.findOne({ _id: body.roleId, workspaceId: req.auth!.workspaceId });
    if (!role) throw new HttpError(404, 'Role not found');

    let user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user) {
      const tempPassword = crypto.randomBytes(12).toString('hex');
      user = await User.create({ name: body.name, email: body.email.toLowerCase(), passwordHash: await bcrypt.hash(tempPassword, 10) });
    }

    const existing = await Membership.findOne({ workspaceId: req.auth!.workspaceId, userId: user._id });
    if (existing) throw new HttpError(400, 'This person is already a member of this workspace');

    const membership = await Membership.create({
      workspaceId: req.auth!.workspaceId,
      userId: user._id,
      roleId: role._id,
      leadershipTitleIds: [],
      status: 'invited',
    });

    res.status(201).json({ membership });
  } catch (err) {
    next(err);
  }
});

const updateMemberSchema = z.object({ roleId: z.string().optional(), status: z.enum(['active', 'invited', 'suspended']).optional() });

workspaceRouter.patch('/members/:id', authenticate, requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = updateMemberSchema.parse(req.body);
    const membership = await Membership.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!membership) throw new HttpError(404, 'Member not found');
    if (body.roleId) {
      const role = await Role.findOne({ _id: body.roleId, workspaceId: req.auth!.workspaceId });
      if (!role) throw new HttpError(404, 'Role not found');
      membership.roleId = role._id;
    }
    if (body.status) membership.status = body.status;
    await membership.save();
    res.json({ membership });
  } catch (err) {
    next(err);
  }
});
