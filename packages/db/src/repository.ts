import { ClientSession, Connection, Model, Types, UpdateQuery } from 'mongoose';
import { getContext, requireTenantId, runWithContext } from './context';

/**
 * The ONLY way feature code reaches data (spec §6.2). Always merges the current
 * tenantId into filters/pipelines and stamps it on writes. The Mongoose plugin
 * independently enforces the same rules as defence in depth.
 */
export class TenantScopedRepository {
  constructor(protected readonly model: Model<any>) {}

  protected scope(filter: Record<string, any> = {}) {
    const tenantId = new Types.ObjectId(requireTenantId());
    if (filter.tenantId !== undefined && String(filter.tenantId) !== String(tenantId)) {
      throw new Error('Filter tenantId does not match the current tenant');
    }
    return { ...filter, tenantId };
  }
  protected opts() {
    const session = getContext()?.session;
    return session ? { session } : {};
  }

  find(filter: Record<string, any> = {}, o: { sort?: any; limit?: number; skip?: number; projection?: any } = {}) {
    let q = this.model.find(this.scope(filter), o.projection, this.opts());
    if (o.sort) q = q.sort(o.sort);
    if (o.skip) q = q.skip(o.skip);
    if (o.limit) q = q.limit(o.limit);
    return q.lean().exec();
  }
  findOne(filter: Record<string, any> = {}) {
    return this.model.findOne(this.scope(filter), null, this.opts()).lean().exec();
  }
  findById(id: string | Types.ObjectId) {
    return this.findOne({ _id: id });
  }
  async create(doc: Record<string, any>) {
    const [created] = await this.model.create([{ ...doc, tenantId: requireTenantId() }], this.opts());
    return created.toObject();
  }
  async createMany(docs: Record<string, any>[]) {
    const tenantId = requireTenantId();
    return this.model.insertMany(docs.map((d) => ({ ...d, tenantId })), this.opts());
  }
  updateOne(filter: Record<string, any>, update: UpdateQuery<any>, o: { upsert?: boolean } = {}) {
    return this.model.updateOne(this.scope(filter), update, { ...this.opts(), ...o }).exec();
  }
  updateMany(filter: Record<string, any>, update: UpdateQuery<any>) {
    return this.model.updateMany(this.scope(filter), update, this.opts()).exec();
  }
  findOneAndUpdate(filter: Record<string, any>, update: UpdateQuery<any>, o: { new?: boolean; upsert?: boolean; sort?: any } = {}) {
    return this.model.findOneAndUpdate(this.scope(filter), update, { ...this.opts(), ...o }).lean().exec();
  }
  deleteOne(filter: Record<string, any>) {
    return this.model.deleteOne(this.scope(filter), this.opts()).exec();
  }
  deleteMany(filter: Record<string, any>) {
    return this.model.deleteMany(this.scope(filter), this.opts()).exec();
  }
  count(filter: Record<string, any> = {}) {
    return this.model.countDocuments(this.scope(filter), this.opts()).exec();
  }
  aggregate<R = any>(pipeline: any[]) {
    // plugin also prepends; doing it here keeps the repo correct on its own
    const agg = this.model.aggregate<R>([{ $match: { tenantId: new Types.ObjectId(requireTenantId()) } }, ...pipeline]);
    const session = getContext()?.session;
    if (session) agg.session(session);
    return agg.exec();
  }
}

/** Run `fn` inside a short multi-document transaction; repositories join it automatically. */
export async function withTransaction<T>(conn: Connection, fn: (session: ClientSession) => Promise<T>): Promise<T> {
  if (getContext()?.session) return fn(getContext()!.session!);
  const session = await conn.startSession();
  try {
    let out!: T;
    await session.withTransaction(async () => {
      out = await runWithContext({ session }, () => fn(session));
    });
    return out;
  } finally {
    await session.endSession();
  }
}
