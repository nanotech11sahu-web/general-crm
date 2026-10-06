import { Global, Module } from '@nestjs/common';
import { createSystemOps, TenantDb, TenantDbRouter, SystemOps } from '@leaddesk/db';
import { keyServiceFromEnv, KeyService } from '@leaddesk/crypto';

export const TENANT_DB = Symbol('TENANT_DB');
export const SYSTEM_OPS = Symbol('SYSTEM_OPS');
export const KEY_SERVICE = Symbol('KEY_SERVICE');
export const DB_ROUTER = Symbol('DB_ROUTER');

@Global()
@Module({
  providers: [
    { provide: DB_ROUTER, useFactory: () => new TenantDbRouter(process.env.MONGO_URL!) },
    { provide: TENANT_DB, inject: [DB_ROUTER], useFactory: (r: TenantDbRouter): Promise<TenantDb> => r.connect() },
    { provide: SYSTEM_OPS, inject: [TENANT_DB], useFactory: (db: TenantDb): SystemOps => createSystemOps(db.models) },
    { provide: KEY_SERVICE, useFactory: (): KeyService => keyServiceFromEnv() },
  ],
  exports: [DB_ROUTER, TENANT_DB, SYSTEM_OPS, KEY_SERVICE],
})
export class DbModule {}
