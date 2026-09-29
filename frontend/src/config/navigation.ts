import {
  Rocket,
  LayoutDashboard,
  Users,
  UploadCloud,
  Sparkles,
  Building2,
  Inbox,
  Calendar,
  Wallet,
  UsersRound,
  Network,
  IdCard,
  Lock,
  ShieldCheck,
  Tag,
  ListChecks,
  FormInput,
  FileText,
  Store,
  Globe,
  Palette,
  BarChart3,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'get-started', label: 'Get Started', to: '/get-started', icon: Rocket },
  { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { key: 'lead-management', label: 'Lead Management', to: '/lead-management', icon: Users },
  { key: 'lead-import', label: 'Lead Import', to: '/lead-management/import', icon: UploadCloud },
  { key: 'ai-suite', label: 'AI Suite', to: '/ai-suite', icon: Sparkles },
  { key: 'hrms', label: 'HRMS', to: '/hrms', icon: IdCard },
  { key: 'operations', label: 'Operations & Inventory', to: '/operations', icon: Building2 },
  { key: 'inbox', label: 'Inbox', to: '/inbox', icon: Inbox },
  { key: 'calendar', label: 'Calendar', to: '/calendar', icon: Calendar },
  { key: 'finance', label: 'Finance', to: '/finance', icon: Wallet },
  { key: 'community', label: 'Community', to: '/community', icon: UsersRound },
  { key: 'agency', label: 'Agency', to: '/agency', icon: Network },
  { key: 'settings-vault', label: 'Vault', to: '/settings/vault', icon: Lock },
  { key: 'settings-staff', label: 'Staff', to: '/settings/staff', icon: Users },
  { key: 'settings-roles', label: 'Roles & Permissions', to: '/settings/roles', icon: ShieldCheck },
  { key: 'settings-tags', label: 'Tags', to: '/settings/tags', icon: Tag },
  { key: 'settings-values', label: 'Values', to: '/settings/values', icon: ListChecks },
  { key: 'settings-fields', label: 'Fields', to: '/settings/fields', icon: FormInput },
  { key: 'settings-templates', label: 'Templates', to: '/settings/templates', icon: FileText },
  { key: 'settings-app-store', label: 'App Store', to: '/settings/app-store', icon: Store },
  { key: 'settings-domains', label: 'Domains', to: '/settings/domains', icon: Globe },
  { key: 'settings-branding', label: 'Branding', to: '/settings/branding', icon: Palette },
  { key: 'settings-analytics', label: 'Analytics', to: '/settings/analytics', icon: BarChart3 },
  { key: 'settings-deleted-items', label: 'Deleted Items', to: '/settings/deleted-items', icon: Trash2 },
];

export interface ExternalLink {
  key: string;
  name: string;
  url: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  { key: 'ai-voice', name: 'AI Voice Call Agent', url: 'https://example.com/ai-voice' },
  { key: 'funnel-waba', name: 'Funnel WABA', url: 'https://example.com/funnel-waba' },
  { key: 'razorpay', name: 'Razorpay Registration', url: 'https://razorpay.com' },
  { key: 'broadcast', name: 'RCS/SMS/Voice Broadcast', url: 'https://example.com/broadcast' },
  { key: 'canva', name: 'Canva', url: 'https://canva.com' },
  { key: 'notes', name: 'Keep Notes', url: 'https://keep.google.com' },
];
