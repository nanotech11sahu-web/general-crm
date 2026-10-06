import { Controller, Headers, Module, Sse, ServiceUnavailableException, MessageEvent } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, RequirePermission } from '../common/guards';
import { RealtimeHub } from './hub.service';

/** GET /v1/stream (SSE). Authenticated with the normal bearer token; events are scoped to the caller's tenant and role. */
@Controller('v1')
export class RealtimeController {
  constructor(private readonly hub: RealtimeHub) {}

  @Sse('stream') @RequirePermission('leads.read')
  stream(@CurrentUser() u: AuthUser, @Headers('last-event-id') lastEventId?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      const send = (e: { id: string; type: string; data: Record<string, unknown> }) => sub.next({ id: e.id, type: e.type, data: e.data });
      const client = this.hub.add({ tenantId: u.tenantId, userId: u.userId, role: u.role, send });
      if (!client) { sub.error(new ServiceUnavailableException('Too many open streams for this user')); return; }
      send({ id: '0', type: 'ready', data: { userId: u.userId } });
      if (lastEventId) void this.hub.replay({ id: client.id, tenantId: u.tenantId, userId: u.userId, role: u.role, send }, lastEventId).then((evs) => evs.forEach(send)).catch(() => undefined);
      const ping = merge(interval(25_000).pipe(map(() => ({ type: 'ping', data: {} } as MessageEvent)))).subscribe((m) => sub.next(m));
      return () => { ping.unsubscribe(); this.hub.remove(client.id); };
    });
  }
}

@Module({ controllers: [RealtimeController], providers: [RealtimeHub], exports: [RealtimeHub] })
export class RealtimeModule {}
