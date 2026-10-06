import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { can, Permission } from '@leaddesk/shared';
import type { AuthUser } from './auth.types';

export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
export const REQUIRED_PERMISSION = 'required_permission';
export const RequirePermission = (p: Permission) => SetMetadata(REQUIRED_PERMISSION, p);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/** Verifies the access JWT and attaches { userId, tenantId, role }. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync(header.slice(7), { secret: process.env.JWT_ACCESS_SECRET });
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
