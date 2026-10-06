import { Schema, Types } from 'mongoose';
import { CrossTenantError, getContext, TenantContextError } from './context';

const QUERY_OPS = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany', 'countDocuments',
] as const;

const sameId = (a: unknown, b: string) => String(a) === String(b);

function resolve(): { tenantId?: string; system: boolean } {
  const ctx = getContext();
  if (ctx?.tenantId) return { tenantId: ctx.tenantId, system: false };
  if (ctx?.system) return { system: true };
  throw new TenantContextError();
}

/** A `$lookup`/`$unionWith`/`$graphLookup` is only allowed in pipeline form whose first stage matches tenantId. */
function assertJoinsAreScoped(pipeline: any[]) {
  for (const stage of pipeline) {
    const join = stage.$lookup ?? stage.$unionWith ?? stage.$graphLookup;
    if (!join) continue;
    const inner = Array.isArray(join.pipeline) ? join.pipeline : undefined;
    const first = inner?.[0]?.$match;
    const scoped = first && JSON.stringify(first).includes('tenantId');
    if (!scoped) throw new CrossTenantError('Joins must use pipeline form with a leading tenantId $match');
    assertJoinsAreScoped(inner!);
  }
}

/**
 * Second layer of defence (spec §6.3). Every query/write needs a tenant context
 * (or a named system operation) and is force-scoped to the current tenant.
 * Pass `{ global: true }` for collections that are not tenant-owned (users, tenants).
 */
export function tenantPlugin(schema: Schema, opts: { global?: boolean } = {}) {
  if (opts.global) return;

  schema.add({ tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true } });

  for (const op of QUERY_OPS) {
    schema.pre(op as any, function (this: any) {
      const { tenantId, system } = resolve();
      const ctx = getContext();
      if (ctx?.session && !this.getOptions().session) this.session(ctx.session);
      if (system) return; // system ops must scope themselves explicitly
      const filter = this.getFilter();
      if (filter.tenantId !== undefined && !sameId(filter.tenantId, tenantId!)) throw new CrossTenantError();
      if (filter.$or || filter.$and || filter.$nor) {
        // keep caller predicates; AND the tenant constraint on top
        this.setQuery({ $and: [filter, { tenantId: new Types.ObjectId(tenantId) }] });
      } else {
        this.setQuery({ ...filter, tenantId: new Types.ObjectId(tenantId) });
      }
      const update = typeof this.getUpdate === 'function' ? this.getUpdate() : undefined;
      if (update) {
        const touched = update.tenantId ?? update.$set?.tenantId ?? update.$setOnInsert?.tenantId;
        if (touched !== undefined && !sameId(touched, tenantId!)) throw new CrossTenantError('tenantId is immutable');
        if (update.$unset?.tenantId !== undefined) throw new CrossTenantError('tenantId is immutable');
      }
    });
  }

  schema.pre('aggregate', function (this: any) {
    const { tenantId, system } = resolve();
    const ctx = getContext();
    if (ctx?.session && !this.options?.session) this.session(ctx.session);
    if (system) return;
    const pipeline = this.pipeline();
    assertJoinsAreScoped(pipeline);
    pipeline.unshift({ $match: { tenantId: new Types.ObjectId(tenantId) } });
  });

  schema.pre('save', function (this: any) {
    const ctx = getContext();
    if (ctx?.session && !this.$session()) this.$session(ctx.session);
  });

  // Runs before required-field validation so tenantId is stamped first.
  schema.pre('validate', function (this: any) {
    const { tenantId, system } = resolve();
    if (system) { if (!this.tenantId) throw new TenantContextError('System writes must set tenantId explicitly'); return; }
    if (this.tenantId && !sameId(this.tenantId, tenantId!)) throw new CrossTenantError();
    this.tenantId = new Types.ObjectId(tenantId);
  });

  schema.pre('insertMany', function (next: any, docs: any) {
    try {
      const { tenantId, system } = resolve();
      for (const d of Array.isArray(docs) ? docs : [docs]) {
        if (system) { if (!d.tenantId) throw new TenantContextError('System writes must set tenantId explicitly'); continue; }
        if (d.tenantId && !sameId(d.tenantId, tenantId!)) throw new CrossTenantError();
        d.tenantId = new Types.ObjectId(tenantId);
      }
      next();
    } catch (e) { next(e as Error); }
  });
}
