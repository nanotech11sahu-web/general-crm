import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from '@leaddesk/db';

/** Puts { tenantId, userId } in AsyncLocalStorage for the handler's whole async tree (spec §6.1). */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const u = req.user;
    if (!u) return next.handle(); // public routes run with no data access
    return new Observable((sub) =>
      runWithTenant(u.tenantId, () => next.handle().subscribe(sub), { userId: u.userId, requestId: req.headers['x-request-id'] }));
  }
}
