import type { ComponentType } from 'react';
import { HrmsIcon, FinanceIcon, LeadsIcon, MeetingsIcon, OperationsIcon, SettingsIcon } from '../components/icons/VerticalIcons';

export interface Vertical {
  key: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  accent: 'violet' | 'emerald' | 'blue' | 'purple' | 'amber' | 'slate';
  homePath: string;
  /** NAV_ITEMS keys shown in this vertical's own sidebar */
  navKeys: string[];
}

export const VERTICALS: Vertical[] = [
  {
    key: 'hrms',
    label: 'HRMS',
    description: 'Staff directory, org chart, hiring & leave',
    icon: HrmsIcon,
    accent: 'violet',
    homePath: '/hrms',
    navKeys: ['hrms'],
  },
  {
    key: 'finance',
    label: 'Finance',
    description: 'Billing, subscriptions, products & tax',
    icon: FinanceIcon,
    accent: 'emerald',
    homePath: '/finance',
    navKeys: ['finance'],
  },
  {
    key: 'leads',
    label: 'Leads',
    description: 'Capture, manage & automate your pipeline',
    icon: LeadsIcon,
    accent: 'blue',
    homePath: '/lead-management',
    navKeys: ['lead-management', 'lead-import', 'lead-automation', 'sales'],
  },
  {
    key: 'meetings',
    label: 'Meetings',
    description: 'Booking pages & calendar',
    icon: MeetingsIcon,
    accent: 'purple',
    homePath: '/calendar',
    navKeys: ['calendar'],
  },
  {
    key: 'operations',
    label: 'Operations & Inventory',
    description: 'Projects & education management',
    icon: OperationsIcon,
    accent: 'amber',
    homePath: '/operations',
    navKeys: ['operations'],
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'Roles, staff, branding & configuration',
    icon: SettingsIcon,
    accent: 'slate',
    homePath: '/settings/vault',
    navKeys: [
      'settings-vault',
      'settings-staff',
      'settings-roles',
      'settings-tags',
      'settings-values',
      'settings-fields',
      'settings-templates',
      'settings-app-store',
      'settings-domains',
      'settings-branding',
      'settings-analytics',
      'settings-deleted-items',
    ],
  },
];

export function findVerticalForPath(pathname: string, navToByKey: Record<string, string>): Vertical | undefined {
  return VERTICALS.find((v) => v.navKeys.some((key) => pathname === navToByKey[key] || pathname.startsWith(`${navToByKey[key]}/`)));
}
