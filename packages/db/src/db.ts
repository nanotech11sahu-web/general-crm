import mongoose, { Connection } from 'mongoose';
import { buildModels, Models } from './models';
import { TenantScopedRepository } from './repository';
import { createRepositories, Repositories } from './repositories';

export interface TenantDb { conn: Connection; models: Models; repos: Repositories }

/**
 * Single choke point for resolving a tenant's database (spec §6.9). Today every
 * tenant shares one database; an enterprise tenant can later be mapped to a
 * dedicated cluster here without touching feature code.
 */
export class TenantDbRouter {
  private shared?: TenantDb;
  private overrides = new Map<string, TenantDb>();

  constructor(private readonly url: string, private readonly dbName?: string) {}

  async connect(): Promise<TenantDb> {
    if (this.shared) return this.shared;
    const conn = await mongoose.createConnection(this.url, { dbName: this.dbName, autoIndex: false }).asPromise();
    const models = buildModels(conn);
    this.shared = { conn, models, repos: createRepositories(models) };
    return this.shared;
  }

  /** Resolve the database for a tenant (shared by default). */
  async resolve(tenantId: string): Promise<TenantDb> {
    return this.overrides.get(tenantId) ?? this.connect();
  }

  registerDedicated(tenantId: string, db: TenantDb) { this.overrides.set(tenantId, db); }

  async close() {
    await this.shared?.conn.close();
    for (const d of this.overrides.values()) await d.conn.close();
  }
}
export { TenantScopedRepository };
