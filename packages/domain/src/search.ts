import type { Role } from '@leaddesk/shared';
import { toObjectId, type TenantDb } from '@leaddesk/db';
import { DomainError } from './errors';
import { nameTokens } from './normalize';
import { presentLead } from './presenter';

export interface LeadQuery {
  q?: string;
  statusId?: string; statusKind?: 'open' | 'won' | 'lost';
  ownerId?: string; unassigned?: boolean; sourceId?: string;
  tag?: string; city?: string;
  createdFrom?: string; createdTo?: string;
  untouchedDays?: number;
}
export const QUERY_KEYS: (keyof LeadQuery)[] = ['q', 'statusId', 'statusKind', 'ownerId', 'unassigned', 'sourceId', 'tag', 'city', 'createdFrom', 'createdTo', 'untouchedDays'];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whitelist -> Mongo filter. Saved views and (later) AI natural-language search
 * produce a LeadQuery, never a raw database query (spec §12).
 */
export function buildLeadFilter(q: LeadQuery, role: Role, extra: { openStatusIds?: unknown[]; wonLostStatusIds?: Record<string, unknown[]> } = {}): Record<string, unknown> {
  for (const k of Object.keys(q)) if (!QUERY_KEYS.includes(k as any)) throw new DomainError('invalid_query', `Unknown filter: ${k}`);
  const and: Record<string, unknown>[] = [{ deletedAt: null }];
  if (q.statusId) and.push({ statusId: toObjectId(q.statusId) });
  if (q.statusKind && extra.wonLostStatusIds) and.push({ statusId: { $in: extra.wonLostStatusIds[q.statusKind] ?? [] } });
  if (q.ownerId) and.push({ ownerId: toObjectId(q.ownerId) });
  if (q.unassigned) and.push({ ownerId: null });
  if (q.sourceId) and.push({ sourceId: toObjectId(q.sourceId) });
  if (q.tag) and.push({ tags: q.tag });
  if (q.city) and.push({ city: new RegExp(`^${escapeRe(q.city)}$`, 'i') });
  if (q.createdFrom || q.createdTo) {
    const r: Record<string, Date> = {};
    if (q.createdFrom) r.$gte = new Date(q.createdFrom);
    if (q.createdTo) r.$lte = new Date(q.createdTo);
    and.push({ createdAt: r });
  }
  if (q.untouchedDays) {
    const cutoff = new Date(Date.now() - q.untouchedDays * 86400_000);
    and.push({ $or: [{ lastContactedAt: null }, { lastContactedAt: { $lt: cutoff } }], createdAt: { $lt: cutoff } });
  }
  if (q.q?.trim()) {
    const term = q.q.trim();
    const digits = term.replace(/\D/g, '');
    const looksPhone = digits.length >= 4 && /^[\d\s+\-()]+$/.test(term);
    if (looksPhone) {
      // Custody: agents cannot probe the number space with short fragments.
      if (role === 'agent' && digits.length < 6) throw new DomainError('search_too_short', 'Enter at least 6 digits to search by phone');
      const last10 = digits.slice(-10);
      const keys = digits.length >= 10 ? [`+${digits}`, digits, last10] : [`s${digits}`, `p${digits}`];
      and.push({ phoneNorms: { $in: keys } });
    } else {
      const tokens = nameTokens(term);
      if (!tokens.length) throw new DomainError('invalid_query', 'Empty search');
      // every typed word must prefix some word of the name (anchored => uses the nameTokens index)
      for (const t of tokens) and.push({ nameTokens: { $regex: `^${escapeRe(t)}` } });
    }
  }
  return and.length === 1 ? and[0] : { $and: and };
}

export interface ListResult { items: any[]; nextCursor: string | null }

export class LeadSearch {
  constructor(private readonly db: TenantDb) {}

  async list(q: LeadQuery, o: { role: Role; scope: Record<string, unknown>; cursor?: string; limit?: number }): Promise<ListResult> {
    const extra: any = {};
    if (q.statusKind) {
      const sts: any[] = await this.db.repos.statuses.find({ kind: q.statusKind });
      extra.wonLostStatusIds = { [q.statusKind]: sts.map((s) => s._id) };
    }
    const limit = Math.min(Math.max(o.limit ?? 50, 1), 200);
    const base = buildLeadFilter(q, o.role, extra);
    const clauses: Record<string, unknown>[] = [base];
    if (Object.keys(o.scope).length) clauses.push(o.scope);
    if (o.cursor) clauses.push({ _id: { $lt: toObjectId(o.cursor) } });
    const rows: any[] = await this.db.repos.leads.find({ $and: clauses }, { sort: { _id: -1 }, limit: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: page.map((l) => presentLead(l, o.role)), nextCursor: rows.length > limit ? String(page[page.length - 1]._id) : null };
  }

  /** Full rows for export (managers/admins only; caller enforces permission). */
  async exportRows(q: LeadQuery, o: { role: Role; scope: Record<string, unknown>; max?: number }) {
    const base = buildLeadFilter(q, o.role);
    const f = Object.keys(o.scope).length ? { $and: [base, o.scope] } : base;
    return this.db.repos.leads.find(f, { sort: { _id: -1 }, limit: o.max ?? 50_000 });
  }
}

/** Neutralise spreadsheet formula injection in exported cells. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
