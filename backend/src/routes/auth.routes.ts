import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { User } from '../models/User';
import { Membership } from '../models/Membership';
import { RefreshToken } from '../models/RefreshToken';
import { createWorkspaceForOwner } from '../services/workspace.service';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { HttpError } from '../middleware/errorHandler';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { env } from '../config/env';

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  workspaceName: z.string().min(1),
});

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokens(userId: string, workspaceId: string, membershipId: string) {
  const accessToken = signAccessToken({ sub: userId, workspaceId, membershipId });
  const refreshToken = signRefreshToken({ sub: userId });
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return { accessToken, refreshToken };
}

authRouter.post('/signup', async (req, res, next) => {
  try {
    const body = signupSchema.parse(req.body);
    const existing = await User.findOne({ email: body.email.toLowerCase() });
    if (existing) {
      throw new HttpError(409, 'Email already in use');
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await User.create({ name: body.name, email: body.email.toLowerCase(), passwordHash });
    const { workspace, membership } = await createWorkspaceForOwner(user._id, body.workspaceName);
    const tokens = await issueTokens(String(user._id), String(workspace._id), String(membership._id));
    res.status(201).json({
      user: { id: user._id, name: user.name, email: user.email },
      workspace: { id: workspace._id, name: workspace.name, slug: workspace.slug },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() });
    if (!user || !(await user.comparePassword(body.password))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const membership = await Membership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
    if (!membership) {
      throw new HttpError(403, 'No active workspace membership');
    }
    const tokens = await issueTokens(String(user._id), String(membership.workspaceId), String(membership._id));
    res.json({ user: { id: user._id, name: user.name, email: user.email }, ...tokens });
  } catch (err) {
    next(err);
  }
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(body.refreshToken);
    const stored = await RefreshToken.findOne({ userId: payload.sub, tokenHash: hashToken(body.refreshToken), revoked: false });
    if (!stored || stored.expiresAt < new Date()) {
      throw new HttpError(401, 'Invalid refresh token');
    }
    const membership = await Membership.findOne({ userId: payload.sub, status: 'active' }).sort({ createdAt: 1 });
    if (!membership) {
      throw new HttpError(403, 'No active workspace membership');
    }
    stored.revoked = true;
    await stored.save();
    const tokens = await issueTokens(payload.sub, String(membership.workspaceId), String(membership._id));
    res.json(tokens);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(body.refreshToken);
    await RefreshToken.updateOne(
      { userId: payload.sub, tokenHash: hashToken(body.refreshToken) },
      { $set: { revoked: true } },
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const switchWorkspaceSchema = z.object({ workspaceId: z.string().min(1) });

authRouter.post('/switch-workspace', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = switchWorkspaceSchema.parse(req.body);
    const membership = await Membership.findOne({ userId: req.auth!.userId, workspaceId: body.workspaceId, status: 'active' });
    if (!membership) throw new HttpError(403, 'You are not an active member of that workspace');
    const tokens = await issueTokens(req.auth!.userId, body.workspaceId, String(membership._id));
    res.json(tokens);
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authenticate, async (req: AuthenticatedRequest, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId).lean();
    if (!user) throw new HttpError(404, 'User not found');
    res.json({
      user: { id: user._id, name: user.name, email: user.email },
      workspaceId: req.auth!.workspaceId,
      permissions: req.auth!.permissions,
    });
  } catch (err) {
    next(err);
  }
});

export const _test = { hashToken, clientOrigin: env.clientOrigin };
