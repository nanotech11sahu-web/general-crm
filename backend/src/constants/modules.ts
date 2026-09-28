export const MODULES = [
  'dashboard',
  'leadGeneration',
  'leadManagement',
  'leadAutomation',
  'sales',
  'aiSuite',
  'operations',
  'inbox',
  'calendar',
  'finance',
  'community',
  'appStore',
  'settings',
  'agencyDashboardPreview',
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const PERMISSION_ACTIONS = ['read', 'create', 'edit', 'delete'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModulePermissions = Record<PermissionAction, boolean>;
export type PermissionMap = Record<ModuleKey, ModulePermissions>;

export function emptyPermissionMap(defaultValue = false): PermissionMap {
  const map = {} as PermissionMap;
  for (const mod of MODULES) {
    map[mod] = { read: defaultValue, create: defaultValue, edit: defaultValue, delete: defaultValue };
  }
  return map;
}

export function fullPermissionMap(): PermissionMap {
  return emptyPermissionMap(true);
}
