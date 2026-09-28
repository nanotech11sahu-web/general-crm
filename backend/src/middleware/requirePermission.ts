import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { ModuleKey, PermissionAction } from '../constants/modules';
import { hasPermission } from '../services/rbac.service';

export function requirePermission(mod: ModuleKey, action: PermissionAction) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!hasPermission(req.auth.permissions, mod, action)) {
      return res.status(403).json({ error: `Missing permission: ${mod}.${action}` });
    }
    return next();
  };
}
