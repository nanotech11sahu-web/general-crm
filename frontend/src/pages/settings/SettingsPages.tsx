import type { ReactNode } from 'react';
import { Lock, Users, ShieldCheck, Tag, ListChecks, FormInput, FileText, Store, Globe, Palette, BarChart3, Trash2 } from 'lucide-react';
import { SettingsSectionHeader, SettingsSectionBody, type SectionAccent } from '../../components/settings/SettingsSectionHeader';
import { VaultTab } from './VaultTab';
import { StaffTab } from './StaffTab';
import { RolesTab } from './RolesTab';
import { TagsTab } from './TagsTab';
import { ValuesTab } from './ValuesTab';
import { FieldsTab } from './FieldsTab';
import { TemplatesTab } from './TemplatesTab';
import { AppStoreTab } from './AppStoreTab';
import { DomainsTab } from './DomainsTab';
import { BrandingTab } from './BrandingTab';
import { AnalyticsTab } from './AnalyticsTab';
import { DeletedItemsTab } from './DeletedItemsTab';

function SettingsPage({
  icon,
  accent,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  accent: SectionAccent;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <SettingsSectionHeader icon={icon} accent={accent} title={title} description={description} />
      <SettingsSectionBody>{children}</SettingsSectionBody>
    </div>
  );
}

export const VaultPage = () => (
  <SettingsPage icon={Lock} accent="indigo" title="Vault" description="Secure file storage shared across your workspace.">
    <VaultTab />
  </SettingsPage>
);
export const StaffPage = () => (
  <SettingsPage icon={Users} accent="blue" title="Staff" description="Add teammates and manage who has access.">
    <StaffTab />
  </SettingsPage>
);
export const RolesPage = () => (
  <SettingsPage icon={ShieldCheck} accent="violet" title="Roles & Permissions" description="Control what each role can see and do.">
    <RolesTab />
  </SettingsPage>
);
export const TagsPage = () => (
  <SettingsPage icon={Tag} accent="pink" title="Tags" description="Organize contacts and records with custom tags.">
    <TagsTab />
  </SettingsPage>
);
export const ValuesPage = () => (
  <SettingsPage icon={ListChecks} accent="teal" title="Values" description="Standard merge tags available across templates.">
    <ValuesTab />
  </SettingsPage>
);
export const FieldsPage = () => (
  <SettingsPage icon={FormInput} accent="cyan" title="Fields" description="Custom fields captured on your records.">
    <FieldsTab />
  </SettingsPage>
);
export const TemplatesPage = () => (
  <SettingsPage icon={FileText} accent="amber" title="Templates" description="Reusable message and document templates.">
    <TemplatesTab />
  </SettingsPage>
);
export const AppStorePage = () => (
  <SettingsPage icon={Store} accent="orange" title="App Store" description="Connect email, payments and third-party apps.">
    <AppStoreTab />
  </SettingsPage>
);
export const DomainsPage = () => (
  <SettingsPage icon={Globe} accent="lime" title="Domains" description="Custom domains for your funnels and forms.">
    <DomainsTab />
  </SettingsPage>
);
export const BrandingPage = () => (
  <SettingsPage icon={Palette} accent="rose" title="Branding" description="Your workspace identity, colors and logo.">
    <BrandingTab />
  </SettingsPage>
);
export const AnalyticsPage = () => (
  <SettingsPage icon={BarChart3} accent="emerald" title="Analytics" description="Usage numbers across your workspace.">
    <AnalyticsTab />
  </SettingsPage>
);
export const DeletedItemsPage = () => (
  <SettingsPage icon={Trash2} accent="slate" title="Deleted Items" description="Restore anything deleted in the last 30 days.">
    <DeletedItemsTab />
  </SettingsPage>
);
