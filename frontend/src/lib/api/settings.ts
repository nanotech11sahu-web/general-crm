import { api } from '../apiClient';
import type {
  RoleDoc,
  LeadershipTitleDoc,
  MemberDoc,
  TagDoc,
  CustomFieldDoc,
  ContentTemplateDoc,
  VaultFileDoc,
  DomainDoc,
  FeatureDomainAssignment,
  BrandingSettingsDoc,
  AppStoreIntegration,
  AnalyticsTile,
  DeletedItemDoc,
  PermissionMap,
} from '../../types/settings';

// --- Roles & Permissions ---
export async function listRoles() {
  const res = await api.get('/roles');
  return res.data as { roles: RoleDoc[]; modules: string[]; actions: string[] };
}

export async function createRole(payload: { name: string; permissions?: Partial<PermissionMap> }) {
  const res = await api.post('/roles', payload);
  return res.data.role as RoleDoc;
}

export async function updateRole(id: string, payload: { name?: string; permissions?: Partial<PermissionMap> }) {
  const res = await api.patch(`/roles/${id}`, payload);
  return res.data.role as RoleDoc;
}

export async function deleteRole(id: string) {
  await api.delete(`/roles/${id}`);
}

export async function listLeadershipTitles() {
  const res = await api.get('/roles/leadership-titles');
  return res.data.titles as LeadershipTitleDoc[];
}

export async function createLeadershipTitle(payload: { name: string }) {
  const res = await api.post('/roles/leadership-titles', payload);
  return res.data.title as LeadershipTitleDoc;
}

// --- Staff / Members ---
export async function listMembers() {
  const res = await api.get('/workspaces/members');
  return res.data.members as MemberDoc[];
}

export async function inviteMember(payload: { name: string; email: string; roleId: string }) {
  const res = await api.post('/workspaces/members/invite', payload);
  return res.data.membership;
}

export async function updateMember(id: string, payload: { roleId?: string; status?: string }) {
  const res = await api.patch(`/workspaces/members/${id}`, payload);
  return res.data.membership;
}

export async function listDepartments() {
  const res = await api.get('/hrm/departments');
  return res.data.departments as { _id: string; name: string }[];
}

export async function createDepartment(name: string) {
  const res = await api.post('/hrm/departments', { name });
  return res.data.department;
}

// --- Tags ---
export async function listTags() {
  const res = await api.get('/tags');
  return res.data.tags as TagDoc[];
}

export async function createTag(payload: { name: string; color?: string; appliesTo: string[]; category?: string }) {
  const res = await api.post('/tags', payload);
  return res.data.tag as TagDoc;
}

export async function updateTag(id: string, payload: Partial<TagDoc>) {
  const res = await api.patch(`/tags/${id}`, payload);
  return res.data.tag as TagDoc;
}

export async function deleteTag(id: string) {
  await api.delete(`/tags/${id}`);
}

// --- Fields ---
export async function listCustomFields(objectType?: string) {
  const res = await api.get('/custom-fields', { params: objectType ? { objectType } : undefined });
  return res.data.fields as CustomFieldDoc[];
}

export async function createCustomField(payload: { objectType: string; label: string; type: string; options?: string[]; required?: boolean; folder?: string }) {
  const res = await api.post('/custom-fields', payload);
  return res.data.field as CustomFieldDoc;
}

export async function deleteCustomField(id: string) {
  await api.delete(`/custom-fields/${id}`);
}

// --- Templates ---
export async function listTemplates(category?: string) {
  const res = await api.get('/templates', { params: category ? { category } : undefined });
  return res.data as { templates: ContentTemplateDoc[]; categories: string[] };
}

export async function createTemplate(payload: { category: string; name: string; content: string }) {
  const res = await api.post('/templates', payload);
  return res.data.template as ContentTemplateDoc;
}

export async function deleteTemplate(id: string) {
  await api.delete(`/templates/${id}`);
}

// --- Vault ---
export async function listVaultFiles(folder?: string) {
  const res = await api.get('/vault/files', { params: folder ? { folder } : undefined });
  return res.data as { files: VaultFileDoc[]; storageUsedBytes: number };
}

export async function listVaultFolders() {
  const res = await api.get('/vault/folders');
  return res.data.folders as string[];
}

export async function uploadVaultFile(payload: { folder?: string; filename: string; mimeType: string; dataBase64: string }) {
  const res = await api.post('/vault/files', payload);
  return res.data;
}

export async function deleteVaultFile(id: string) {
  await api.delete(`/vault/files/${id}`);
}

// --- Domains ---
export async function listDomains() {
  const res = await api.get('/domains');
  return res.data.domains as DomainDoc[];
}

export async function addDomain(hostname: string) {
  const res = await api.post('/domains', { hostname });
  return res.data.domain as DomainDoc;
}

export async function verifyDomain(id: string) {
  const res = await api.post(`/domains/${id}/verify`);
  return res.data.domain as DomainDoc;
}

export async function listFeatureAssignments() {
  const res = await api.get('/domains/feature-assignments');
  return res.data.assignments as FeatureDomainAssignment[];
}

export async function assignFeatureDomain(payload: { domainId: string; feature: string; targetId?: string }) {
  const res = await api.post('/domains/feature-assignments', payload);
  return res.data.assignment as FeatureDomainAssignment;
}

// --- Branding ---
export async function getBranding() {
  const res = await api.get('/branding');
  return res.data.branding as BrandingSettingsDoc;
}

export async function updateBranding(payload: Partial<BrandingSettingsDoc>) {
  const res = await api.patch('/branding', payload);
  return res.data.branding as BrandingSettingsDoc;
}

// --- App Store ---
export async function listAppStoreIntegrations() {
  const res = await api.get('/app-store/integrations');
  return res.data.integrations as AppStoreIntegration[];
}

export async function connectSmtp(payload: { host: string; port: number; username: string; password: string; fromEmail: string }) {
  const res = await api.post('/app-store/integrations/smtp/connect', payload);
  return res.data.connection;
}

export async function connectGenericIntegration(key: string, config: Record<string, unknown> = {}) {
  const res = await api.post(`/app-store/integrations/${key}/connect`, config);
  return res.data.integration;
}

export async function disconnectGenericIntegration(key: string) {
  const res = await api.post(`/app-store/integrations/${key}/disconnect`);
  return res.data;
}

export async function getMetaLeadAdsOAuthUrl(intent: 'facebook_lead_ads' | 'instagram_lead_ads') {
  const res = await api.get('/app-store/integrations/meta/oauth-url', { params: { intent } });
  return res.data.url as string;
}

export interface MetaAppConfigDoc {
  appId: string | null;
  configured: boolean;
  redirectUri: string;
}

export async function getMetaAppConfig() {
  const res = await api.get('/app-store/integrations/meta/config');
  return res.data as MetaAppConfigDoc;
}

export async function saveMetaAppConfig(payload: { appId: string; appSecret: string }) {
  const res = await api.put('/app-store/integrations/meta/config', payload);
  return res.data as MetaAppConfigDoc;
}

export async function deleteMetaAppConfig() {
  const res = await api.delete('/app-store/integrations/meta/config');
  return res.data as { configured: boolean };
}

export async function connectRazorpay(payload: { keyId: string; keySecret: string }) {
  const res = await api.post('/app-store/integrations/razorpay/connect', payload);
  return res.data.connection;
}

export async function disconnectRazorpay() {
  const res = await api.post('/app-store/integrations/razorpay/disconnect');
  return res.data;
}

// --- Analytics ---
export async function getAnalytics() {
  const res = await api.get('/analytics');
  return res.data.tiles as AnalyticsTile[];
}

// --- Deleted Items ---
export async function listDeletedItems() {
  const res = await api.get('/deleted-items');
  return res.data.items as DeletedItemDoc[];
}

export async function restoreDeletedItem(id: string) {
  const res = await api.post(`/deleted-items/${id}/restore`);
  return res.data.item as DeletedItemDoc;
}

export async function purgeDeletedItem(id: string) {
  await api.delete(`/deleted-items/${id}`);
}
