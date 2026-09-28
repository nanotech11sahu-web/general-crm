export interface AiBrainPackDefinition {
  key: string;
  name: string;
  /** Whether this pack's seed docs are grounded in real, queryable workspace data today. */
  hasLiveData: boolean;
}

/**
 * The full AI Brain knowledge-pack catalog from the build spec — one read-only pack per
 * module. Packs whose owning module already exists (Calendar, Prospecting, Workflows,
 * WhatsApp, Email Marketing, Finance, Ad Launcher, Forms, Chat Widget) are seeded from
 * real workspace data; packs for modules that ship in later phases (Vault, Community & LMS,
 * Inbox, Shop, Business Profile, Settings, School, Tasks, HRM) get a seeded placeholder doc
 * that says so explicitly, per the build prompt's own "say so explicitly" rule.
 */
export const AI_BRAIN_PACKS: AiBrainPackDefinition[] = [
  { key: 'calendar', name: 'Calendar & Appointments', hasLiveData: true },
  { key: 'prospecting', name: 'Prospecting', hasLiveData: true },
  { key: 'vault', name: 'Vault', hasLiveData: false },
  { key: 'community', name: 'Community & LMS', hasLiveData: false },
  { key: 'inbox', name: 'Inbox', hasLiveData: false },
  { key: 'workflows', name: 'Workflows & Chatflows', hasLiveData: true },
  { key: 'whatsapp', name: 'WhatsApp', hasLiveData: true },
  { key: 'emailMarketing', name: 'Email Marketing', hasLiveData: true },
  { key: 'finance', name: 'Finance', hasLiveData: true },
  { key: 'adLauncher', name: 'Ad Launcher', hasLiveData: true },
  { key: 'forms', name: 'Forms', hasLiveData: true },
  { key: 'chatWidget', name: 'Chat Widget', hasLiveData: true },
  { key: 'shop', name: 'Shop', hasLiveData: false },
  { key: 'businessProfile', name: 'Business Profile', hasLiveData: false },
  { key: 'settings', name: 'Settings', hasLiveData: false },
  { key: 'school', name: 'School', hasLiveData: false },
  { key: 'tasks', name: 'Tasks', hasLiveData: false },
  { key: 'hrm', name: 'HRM', hasLiveData: false },
];

export function getBrainPack(key: string): AiBrainPackDefinition | undefined {
  return AI_BRAIN_PACKS.find((p) => p.key === key);
}
