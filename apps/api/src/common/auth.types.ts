import type { Role } from '@leaddesk/shared';

export interface AuthUser { userId: string; tenantId: string; role: Role; membershipId: string; /** The workspace requires a second factor for this role and the person has not set one up yet. */ needs2fa?: boolean }
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}
