import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { resolveEffectivePermissions } from '../services/rbac.service';
import { PermissionMap } from '../constants/modules';

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    workspaceId: string;
    membershipId: string;
    permissions: PermissionMap;
  };
}

export async function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = verifyAccessToken(token);
    const permissions = await resolveEffectivePermissions(payload.membershipId);
    req.auth = {
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      membershipId: payload.membershipId,
      permissions,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
