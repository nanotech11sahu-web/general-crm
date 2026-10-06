import type { Role } from '@leaddesk/shared';

export interface AuthUser { userId: string; tenantId: string; role: Role; membershipId: string }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}
