import type { Repositories } from '@leaddesk/db';

interface Preset {
  statuses: { name: string; kind: 'open' | 'won' | 'lost'; color?: string; requiresFields?: string[] }[];
  lostReasons: string[];
  customFields: { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; options?: string[] }[];
}

export const PRESETS: Record<string, Preset> = {
  generic: {
    statuses: [
      { name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Qualified', kind: 'open' },
      { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' },
    ],
    lostReasons: ['Not interested', 'Wrong number', 'Price', 'Went to competitor', 'No response'],
    customFields: [],
  },
  real_estate: {
    statuses: [
      { name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Interested', kind: 'open' },
      { name: 'Site Visit Scheduled', kind: 'open' }, { name: 'Site Visit Done', kind: 'open' }, { name: 'Negotiation', kind: 'open' },
      { name: 'Booked', kind: 'won' }, { name: 'Lost', kind: 'lost' },
    ],
    lostReasons: ['Not interested', 'Budget mismatch', 'Location mismatch', 'Bought elsewhere', 'No response', 'Wrong number'],
    customFields: [
      { key: 'budget', label: 'Budget', type: 'text' },
      { key: 'bhk', label: 'BHK', type: 'select', options: ['1', '2', '3', '4+'] },
      { key: 'location_pref', label: 'Location preference', type: 'text' },
      { key: 'timeline', label: 'Timeline', type: 'text' },
      { key: 'project', label: 'Project', type: 'text' },
    ],
  },
  education: {
    statuses: [
      { name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Counselling Done', kind: 'open' },
      { name: 'Application Started', kind: 'open' }, { name: 'Enrolled', kind: 'won' }, { name: 'Lost', kind: 'lost' },
    ],
    lostReasons: ['Not interested', 'Fees', 'Chose another institute', 'Not eligible', 'No response', 'Wrong number'],
    customFields: [
      { key: 'course', label: 'Course', type: 'text' },
      { key: 'qualification', label: 'Qualification', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'intake', label: 'Intake', type: 'text' },
    ],
  },
};

/** Seed statuses, lost reasons and custom fields. Everything stays editable; presets are just data. */
export async function seedPreset(repos: Repositories, name: string) {
  const p = PRESETS[name] ?? PRESETS.generic;
  await repos.statuses.createMany(p.statuses.map((s, i) => ({ ...s, position: i, requiresFields: s.requiresFields ?? [] })));
  await repos.lostReasons.createMany(p.lostReasons.map((label) => ({ label })));
  if (p.customFields.length) await repos.customFields.createMany(p.customFields.map((f) => ({ ...f, options: f.options ?? [], showInList: false })));
  await repos.sources.createMany([{ kind: 'manual', name: 'Manual entry' }, { kind: 'import', name: 'Import' }, { kind: 'api', name: 'API' }]);
}
