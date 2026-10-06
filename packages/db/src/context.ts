import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSession } from 'mongoose';

export interface RequestContext {
  tenantId?: string;
  userId?: string;
  requestId?: string;
  /** Set only by runAsSystem; names the audited system operation. */
  system?: string;
  session?: ClientSession;
}

export class TenantContextError extends Error {
  constructor(msg = 'No tenant context: data access outside a tenant scope is forbidden') {
    super(msg);
    this.name = 'TenantContextError';
  }
}
export class CrossTenantError extends Error {
  constructor(msg = 'Cross-tenant access attempt blocked') {
    super(msg);
    this.name = 'CrossTenantError';
  }
}

/** Closed list: system operations are named, limited and audited (spec §6.5). */
export const SYSTEM_OPERATIONS = [
  'webhook.resolveConnection',
  'outbox.dispatch',
  'tasks.sweep',
  'sla.sweep',
  'cadence.sweep',
  'pulse.sweep',
  'ai.sweep',
  'ops.stats',
  'billing.webhook',
  'platform.operator',
  'ops.sweep',
  'scheduler.listConnections',
  'auth.findUserByEmail',
  'auth.listMemberships',
  'auth.refreshToken',
  'auth.acceptInvitation',
  'migration',
  'test',
] as const;
export type SystemOperation = (typeof SYSTEM_OPERATIONS)[number];

const als = new AsyncLocalStorage<RequestContext>();

export const getContext = (): RequestContext | undefined => als.getStore();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  const parent = als.getStore();
  return als.run({ ...parent, ...ctx }, fn);
}

export function runWithTenant<T>(tenantId: string, fn: () => T, extra: Omit<RequestContext, 'tenantId' | 'system'> = {}): T {
  if (!tenantId) throw new TenantContextError('runWithTenant requires a tenantId');
  // A tenant scope never inherits an enclosing system scope or transaction.
  return als.run({ ...extra, tenantId }, fn);
}

type SystemAuditHook = (op: SystemOperation) => void;
let systemAuditHook: SystemAuditHook | undefined;
export const onSystemOperation = (h: SystemAuditHook) => { systemAuditHook = h; };

export function runAsSystem<T>(op: SystemOperation, fn: () => T): T {
  if (!SYSTEM_OPERATIONS.includes(op)) throw new Error(`Unknown system operation: ${op}`);
  systemAuditHook?.(op);
  return als.run({ system: op }, fn);
}

export function requireTenantId(): string {
  const id = als.getStore()?.tenantId;
  if (!id) throw new TenantContextError();
  return id;
}
