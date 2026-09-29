import { Users, UploadCloud, type LucideIcon } from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'lead-management', label: 'Lead Management', to: '/lead-management', icon: Users },
  { key: 'lead-import', label: 'Lead Import', to: '/lead-management/import', icon: UploadCloud },
];

export interface ExternalLink {
  key: string;
  name: string;
  url: string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [];
