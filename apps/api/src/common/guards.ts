import { Global, Module, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { runWithTenant, type TenantDb } from '@leaddesk/db';
import { TENANT_DB } from '@leaddesk/platform';
import { JwtService } from '@nestjs/jwt';
import { can, Permission } from '@leaddesk/shared';
import type { AuthUser } from './auth.types';

export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
export const REQUIRED_PERMISSION = 'required_permission';
export const RequirePermission = (p: Permission) => SetMetadata(REQUIRED_PERMISSION, p);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/**
 * Access tokens live 15 min, but an offboarded/deactivated member must lose access
 * immediately: every request checks membership status (cached briefly; offboarding
 * invalidates the local entry, other instances converge within TTL).
 */
@Injectable()
export class MembershipCache {
  private readonly m = new Map<string, { active: boolean; exp: number }>();
  private readonly ttlMs = 10_000;
  constructor(@Inject(TENANT_DB) private readonly db: TenantDb) {}
  invalidate(membershipId: string) { this.m.delete(membershipId); }
  async isActive(tenantId: string, membershipId: string): Promise<boolean> {
    const hit = this.m.get(membershipId);
    if (hit && hit.exp > Date.now()) return hit.active;
    const row: any = await runWithTenant(tenantId, () => this.db.repos.memberships.findOne({ _id: membershipId }));
    const tenant: any = await this.db.models.Tenant.findById(tenantId, { status: 1 }).lean().exec(); // suspended / deleting workspaces lose access within the cache TTL
    const active = row?.status === 'active' && (!tenant?.status || tenant.status === 'active');
    this.m.set(membershipId, { active, exp: Date.now() + this.ttlMs });
    return active;
  }
}

/** Verifies the access JWT and attaches { userId, tenantId, role }. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly members: MembershipCache) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync(header.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
      if (!(await this.members.isActive(p.tid, p.mid))) throw new Error('inactive');
      req.user = { userId: p.sub, tenantId: p.tid, role: p.role, membershipId: p.mid } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const need = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!need) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !can(user.role, need)) throw new ForbiddenException(`Missing permission: ${need}`);
    return true;
  }
}

@Global()
@Module({ providers: [MembershipCache], exports: [MembershipCache] })
export class CommonModule {}
