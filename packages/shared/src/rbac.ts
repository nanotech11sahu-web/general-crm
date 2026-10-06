export const ROLES = ['owner', 'admin', 'manager', 'agent'] as const;
export type Role = (typeof ROLES)[number];
export type VisibilityScope = 'own' | 'team' | 'all';

/** Permissions are code-defined; roles map to sets (spec §7). */
export const PERMISSIONS = [
  'tenant.manage', 'billing.manage', 'tenant.delete', 'security.manage',
  'users.manage', 'users.offboard', 'users.invite',
  'connections.manage', 'connections.view',
  'rules.manage', 'statuses.manage', 'imports.manage',
  'leads.read', 'leads.write', 'leads.reassign', 'leads.export',
  'calls.listen', 'pulse.view', 'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const agent: Permission[] = ['leads.read', 'leads.write'];
const manager: Permission[] = [...agent, 'leads.reassign', 'leads.export', 'calls.listen', 'pulse.view', 'users.invite', 'connections.view'];
const admin: Permission[] = [...manager, 'users.manage', 'users.offboard', 'connections.manage', 'rules.manage', 'statuses.manage', 'imports.manage', 'audit.view', 'tenant.manage'];
const owner: Permission[] = [...admin, 'billing.manage', 'tenant.delete', 'security.manage'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  agent: new Set(agent), manager: new Set(manager), admin: new Set(admin), owner: new Set(owner),
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].has(p);

export const defaultScope = (role: Role): VisibilityScope =>
  role === 'agent' ? 'own' : role === 'manager' ? 'team' : 'all';
