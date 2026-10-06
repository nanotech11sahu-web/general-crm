import { Body, Controller, Delete, Get, Inject, Injectable, Logger, Module, Param, Post, Put, Query } from '@nestjs/common';
import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import type { ConnectorRegistry, FetchLike } from '@leaddesk/connectors-core';
import { createRegistry } from '@leaddesk/connectors';
import type { KeyService } from '@leaddesk/crypto';
import { ConnectionService, InboxService, objectStoreFromEnv } from '@leaddesk/domain';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import { runWithTenant, type TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermission } from '../common/guards';
import type { AuthUser } from '../common/auth.types';

export const REGISTRY = Symbol('REGISTRY');
/** Outbound fetch for connectors/OAuth; undefined = real network. Tests inject recorded fixtures. */
export const HTTP_FETCH = Symbol('HTTP_FETCH');

class CreateConnectionDto {
  @IsString() provider!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsObject() credentials?: Record<string, string>;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class ReconnectDto {
  @IsObject() credentials!: Record<string, string>;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class ConfigDto { @IsObject() config!: Record<string, unknown> }
class TestLeadDto { @IsOptional() @IsObject() fields?: Record<string, unknown> }

@Injectable()
export class ConnectFacade {
  readonly conns: ConnectionService;
  readonly inbox: InboxService;
  private readonly log = new Logger('Connect');
  constructor(
    @Inject(TENANT_DB) readonly db: TenantDb,
    @Inject(KEY_SERVICE) keys: KeyService,
    @Inject(REGISTRY) readonly registry: ConnectorRegistry,
    readonly audit: AuditService,
  ) {
    this.conns = new ConnectionService(db, keys, registry);
    this.inbox = new InboxService(db, registry, 8, keys, { store: objectStoreFromEnv() });
  }
  /** Replay runs in-process like imports; the worker runs the same InboxService from the queue. */
  replayAsync(tenantId: string, userId: string, inboxId: string) {
    setImmediate(() => { runWithTenant(tenantId, () => this.inbox.replay(inboxId), { userId }).catch((e) => this.log.error(`replay ${inboxId}: ${e?.message}`)); });
  }
}

@Controller('v1')
export class ConnectController {
  constructor(private readonly f: ConnectFacade) {}

  /** The UI is generated from these manifests: adding a provider needs no frontend change. */
  @Get('connectors') @RequirePermission('connections.view')
  connectors() { return this.f.registry.manifests().map(({ webhook, ...m }) => ({ ...m, hasWebhook: !!webhook })); }

  @Get('connections') @RequirePermission('connections.view')
  list() { return this.f.conns.list(); }

  @Post('connections') @RequirePermission('connections.manage')
  async create(@Body() b: CreateConnectionDto) {
    const { connection, revealedOnce, capabilities } = await this.f.conns.create(b);
    await this.f.audit.record({ action: 'connection.created', entity: 'connection', entityId: connection.id, meta: { provider: b.provider } });
    return { connection, revealedOnce, capabilities }; // revealedOnce is shown exactly once; secrets are never returned again
  }

  @Post('connections/:id/verify') @RequirePermission('connections.manage')
  verify(@Param('id') id: string) { return this.f.conns.verify(id); }

  @Post('connections/:id/test') @RequirePermission('connections.manage')
  async test(@Param('id') id: string, @Body() b: TestLeadDto) {
    const out = await this.f.inbox.testLead(id, b.fields ?? { id: `test-${Date.now()}`, name: 'Test Lead (safe to delete)', phone: `+9199${String(Date.now()).slice(-8)}`, source: 'connection test' });
    await this.f.audit.record({ action: 'connection.test_lead', entity: 'connection', entityId: id });
    return out;
  }

  @Post('connections/:id/reconnect') @RequirePermission('connections.manage')
  async reconnect(@Param('id') id: string, @Body() b: ReconnectDto) {
    const out = await this.f.conns.replaceCredentials(id, b.credentials, b.config);
    await this.f.audit.record({ action: 'connection.credentials_replaced', entity: 'connection', entityId: id });
    return out;
  }

  @Put('connections/:id/config') @RequirePermission('connections.manage')
  config(@Param('id') id: string, @Body() b: ConfigDto) { return this.f.conns.setConfig(id, b.config); }

  @Delete('connections/:id') @RequirePermission('connections.manage')
  async revoke(@Param('id') id: string) {
    await this.f.conns.revoke(id);
    await this.f.audit.record({ action: 'connection.revoked', entity: 'connection', entityId: id });
    return { ok: true };
  }

  @Get('connections/:id/health') @RequirePermission('connections.view')
  async health(@Param('id') id: string) {
    const c = await this.f.conns.get(id);
    return { connection: this.f.conns.view(c), checks: await this.f.conns.checks(id) };
  }

  @Get('connections/:id/logs') @RequirePermission('connections.view')
  logs(@Param('id') id: string) { return this.f.conns.logs(id); }

  @Get('inbox') @RequirePermission('connections.manage')
  inbox(@Query('status') status?: string) {
    if (status && !['failed', 'dead', 'failed,dead'].includes(status)) return this.f.db.repos.inbox.find({ status }, { sort: { receivedAt: -1 }, limit: 100 });
    return this.f.inbox.needsAttention();
  }

  @Post('inbox/:id/replay') @RequirePermission('connections.manage')
  async replay(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const out = await this.f.inbox.replay(id);
    await this.f.audit.record({ action: 'inbox.replayed', entity: 'inbox', entityId: id });
    return out;
  }
}

@Module({
  controllers: [ConnectController],
  providers: [
    ConnectFacade,
    { provide: HTTP_FETCH, useValue: undefined },
    { provide: REGISTRY, inject: [HTTP_FETCH], useFactory: (f: FetchLike | undefined) => createRegistry(process.env, f) },
  ],
  exports: [ConnectFacade, REGISTRY, HTTP_FETCH],
})
export class ConnectionsModule {}
