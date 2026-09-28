import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { HttpError } from '../middleware/errorHandler';
import { Agency } from '../models/Agency';
import { Workspace } from '../models/Workspace';
import { createAgencyForWorkspace, createSubAccount, listAgencyWorkspaces, computeAgencyRollup } from '../services/agency.service';

export const agencyRouter = Router();

agencyRouter.use(authenticate);

async function requireAgencyOwner(req: AuthenticatedRequest) {
  const workspace = await Workspace.findById(req.auth!.workspaceId).lean();
  if (!workspace?.agencyId) throw new HttpError(404, 'This workspace is not part of an agency yet');
  const agency = await Agency.findById(workspace.agencyId).lean();
  if (!agency || String(agency.ownerUserId) !== req.auth!.userId) {
    throw new HttpError(403, 'Only the agency owner can manage sub-accounts');
  }
  return agency;
}

agencyRouter.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspace = await Workspace.findById(req.auth!.workspaceId).lean();
    if (!workspace?.agencyId) return res.json({ agency: null, workspaces: [] });
    const agency = await Agency.findById(workspace.agencyId).lean();
    const workspaces = await listAgencyWorkspaces(String(workspace.agencyId));
    res.json({ agency, workspaces });
  } catch (err) {
    next(err);
  }
});

const createAgencySchema = z.object({ name: z.string().min(1) });

agencyRouter.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const workspace = await Workspace.findById(req.auth!.workspaceId).lean();
    if (workspace?.agencyId) throw new HttpError(400, 'This workspace already belongs to an agency');
    const body = createAgencySchema.parse(req.body);
    const agency = await createAgencyForWorkspace(new Types.ObjectId(req.auth!.userId), req.auth!.workspaceId, body.name);
    res.status(201).json({ agency });
  } catch (err) {
    next(err);
  }
});

const createSubAccountSchema = z.object({ name: z.string().min(1) });

agencyRouter.post('/sub-accounts', async (req: AuthenticatedRequest, res, next) => {
  try {
    const agency = await requireAgencyOwner(req);
    const body = createSubAccountSchema.parse(req.body);
    const { workspace } = await createSubAccount(new Types.ObjectId(req.auth!.userId), String(agency._id), body.name);
    res.status(201).json({ workspace });
  } catch (err) {
    next(err);
  }
});

agencyRouter.get('/rollup', async (req: AuthenticatedRequest, res, next) => {
  try {
    const agency = await requireAgencyOwner(req);
    const rollup = await computeAgencyRollup(String(agency._id));
    res.json(rollup);
  } catch (err) {
    next(err);
  }
});
