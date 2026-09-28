import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  workspaceId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  permissions: Record<string, Record<string, boolean>> | null;
  setSession: (data: {
    user: AuthUser;
    workspaceId: string;
    accessToken: string;
    refreshToken: string;
    permissions?: Record<string, Record<string, boolean>>;
  }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setWorkspaceId: (workspaceId: string) => void;
  setPermissions: (permissions: Record<string, Record<string, boolean>>) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      workspaceId: null,
      accessToken: null,
      refreshToken: null,
      permissions: null,
      setSession: ({ user, workspaceId, accessToken, refreshToken, permissions }) =>
        set({ user, workspaceId, accessToken, refreshToken, permissions: permissions ?? null }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setWorkspaceId: (workspaceId) => set({ workspaceId }),
      setPermissions: (permissions) => set({ permissions }),
      clear: () => set({ user: null, workspaceId: null, accessToken: null, refreshToken: null, permissions: null }),
    }),
    { name: 'pmc-crm-auth' },
  ),
);
