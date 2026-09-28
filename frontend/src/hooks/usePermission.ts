import { useAuthStore } from '../stores/authStore';

export type PermissionAction = 'read' | 'create' | 'edit' | 'delete';

export function usePermission(mod: string, action: PermissionAction = 'read'): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return Boolean(permissions?.[mod]?.[action]);
}
