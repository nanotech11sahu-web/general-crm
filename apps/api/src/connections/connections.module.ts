import { Body, Controller, Get, Inject, Injectable, Module, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { openSecret, sealSecret, type KeyService } from '@leaddesk/crypto';
import { newObjectId, requireTenantId, type TenantDb } from '@leaddesk/db';
import { AuditService } from '../audit/audit.service';
import { KEY_SERVICE, TENANT_DB } from '@leaddesk/platform';
import { RequirePermission } from '../common/guards';

class CreateConnectionDto {
  @IsString() provider!: string;
  @IsString() category!: string;
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) secret!: string;
}

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(TENANT_DB) private readonly db: TenantDb,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    private readonly audit: AuditService,
  ) {}

  /** Secrets are write-only: sealed on the way in, never returned. */
  async create(i: CreateConnectionDto) {
    const tenantId = requireTenantId();
    const id = newObjectId();
    const sealed = await sealSecret(this.keys, { tenantId, connectionId: String(id) }, i.secret);
    const conn: any = await this.db.repos.connections.create({
      _id: id, provider: i.provider, category: i.category, name: i.name,
      publicId: randomBytes(18).toString('base64url'),
      secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: sealed.hint,
    });
    await this.audit.record({ action: 'connection.created', entity: 'connection', entityId: String(conn._id), meta: { provider: i.provider } });
    return this.view(conn);
  }
  async list() { return (await this.db.repos.connections.listSafe()).map((c: any) => this.view(c)); }

  /** Decrypt only at call time, in memory, inside the connector execution layer. */
  async withSecret<T>(connectionId: string, fn: (secret: string) => Promise<T>): Promise<T> {
    const c: any = await this.db.repos.connections.findOne({ _id: connectionId });
    if (!c) throw new Error('Connection not found');
    return fn(await openSecret(this.keys, { tenantId: requireTenantId(), connectionId }, { ciphertext: c.secretCiphertext, wrappedDek: c.secretWrappedDek }));
  }

  private view(c: any) {
    return { id: String(c._id), provider: c.provider, category: c.category, name: c.name, status: c.status, publicId: c.publicId, secretHint: c.secretHint };
  }
}

@Controller('v1/connections')
export class ConnectionsController {
  constructor(private readonly svc: ConnectionsService) {}
  @Get() @RequirePermission('connections.view') list() { return this.svc.list(); }
  @Post() @RequirePermission('connections.manage') create(@Body() b: CreateConnectionDto) { return this.svc.create(b); }
}

@Module({ controllers: [ConnectionsController], providers: [ConnectionsService], exports: [ConnectionsService] })
export class ConnectionsModule {}
