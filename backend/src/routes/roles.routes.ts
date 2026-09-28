import { Router } from 'express';
import { z } from 'zod';
import { Role } from '../models/Role';
import { LeadershipTitle } from '../models/LeadershipTitle';
import { MODULES, PERMISSION_ACTIONS, emptyPermissionMap } from '../constants/modules';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';

export const rolesRouter = Router();

rolesRouter.use(authenticate);

rolesRouter.get('/', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const roles = await Role.find({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ roles, modules: MODULES, actions: PERMISSION_ACTIONS });
  } catch (err) {
    next(err);
  }
});

const modulePermSchema = z.object({
  read: z.boolean().optional(),
  create: z.boolean().optional(),
  edit: z.boolean().optional(),
  delete: z.boolean().optional(),
});

const createRoleSchema = z.object({
  name: z.string().min(1),
  permissions: z.record(z.string(), modulePermSchema).optional(),
});

rolesRouter.post('/', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = createRoleSchema.parse(req.body);
    const permissions = emptyPermissionMap();
    if (body.permissions) {
      for (const [mod, perms] of Object.entries(body.permissions)) {
        if (MODULES.includes(mod as (typeof MODULES)[number])) {
          Object.assign(permissions[mod as (typeof MODULES)[number]], perms);
        }
      }
    }
    const role = await Role.create({ workspaceId: req.auth!.workspaceId, name: body.name, permissions, isSystem: false });
    res.status(201).json({ role });
  } catch (err) {
    next(err);
  }
});

rolesRouter.patch('/:id', requirePermission('settings', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!role) throw new HttpError(404, 'Role not found');
    if (role.isSystem) throw new HttpError(400, 'Cannot edit the system Owner role');
    const body = createRoleSchema.partial().parse(req.body);
    if (body.name) role.name = body.name;
    if (body.permissions) {
      for (const [mod, perms] of Object.entries(body.permissions)) {
        if (MODULES.includes(mod as (typeof MODULES)[number])) {
          Object.assign(role.permissions[mod as (typeof MODULES)[number]], perms);
        }
      }
    }
    await role.save();
    res.json({ role });
  } catch (err) {
    next(err);
  }
});

rolesRouter.delete('/:id', requirePermission('settings', 'delete'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, workspaceId: req.auth!.workspaceId });
    if (!role) throw new HttpError(404, 'Role not found');
    if (role.isSystem) throw new HttpError(400, 'Cannot delete the system Owner role');
    await role.deleteOne();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

const leadershipTitleSchema = z.object({
  name: z.string().min(1),
  overrides: z.record(z.string(), modulePermSchema).optional(),
});

rolesRouter.get('/leadership-titles', requirePermission('settings', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const titles = await LeadershipTitle.find({ workspaceId: req.auth!.workspaceId }).lean();
    res.json({ titles });
  } catch (err) {
    next(err);
  }
});

rolesRouter.post('/leadership-titles', requirePermission('settings', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = leadershipTitleSchema.parse(req.body);
    const title = await LeadershipTitle.create({
      workspaceId: req.auth!.workspaceId,
      name: body.name,
      overrides: body.overrides ?? {},
    });
    res.status(201).json({ title });
  } catch (err) {
    next(err);
  }
});
