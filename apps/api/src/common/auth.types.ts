import type { Role } from '@leaddesk/shared';

export interface AuthUser { userId: string; tenantId: string; role: Role; membershipId: string }
declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}
