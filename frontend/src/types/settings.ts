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

export interface RoleDoc {
  _id: string;
  name: string;
  isSystem: boolean;
  permissions: PermissionMap;
}

export interface LeadershipTitleDoc {
  _id: string;
  name: string;
  overrides: Partial<Record<ModuleKey, Partial<ModulePermissions>>>;
}

export interface MemberDoc {
  _id: string;
  userId: { _id: string; name: string; email: string };
  roleId: { _id: string; name: string };
  status: 'active' | 'invited' | 'suspended';
}

export interface TagDoc {
  _id: string;
  name: string;
  color: string;
  appliesTo: string[];
  usageCount: number;
  category?: string;
  order: number;
}

export interface CustomFieldDoc {
  _id: string;
  objectType: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  folder?: string;
  order: number;
  isStandard: boolean;
}

export interface ContentTemplateDoc {
  _id: string;
  category: string;
  name: string;
  content: string;
}

export interface VaultFileDoc {
  _id: string;
  folder: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface DomainDoc {
  _id: string;
  hostname: string;
  verified: boolean;
}

export interface FeatureDomainAssignment {
  _id: string;
  domainId: { _id: string; hostname: string; verified: boolean };
  feature: 'funnel' | 'form' | 'store' | 'community' | 'portal';
  targetId?: string;
}

export interface BrandingSettingsDoc {
  logoLightUrl?: string;
  logoDarkUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  loaderText?: string;
  mobileNavLocked: boolean;
  experienceName: string;
}

export interface AppStoreIntegration {
  key: string;
  name: string;
  category: string;
  connected: boolean;
}

export interface AnalyticsTile {
  key: string;
  label: string;
  value: number | null;
  module: string;
}

export interface DeletedItemDoc {
  _id: string;
  module: string;
  originalCollection: string;
  deletedAt: string;
  purgeAt: string;
  restored: boolean;
}
