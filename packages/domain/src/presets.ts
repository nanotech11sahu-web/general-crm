import type { Repositories } from '@leaddesk/db';

interface OutcomeDef { label: string; kind: 'connected' | 'not_connected' | 'dead'; requiresNextAction: boolean; defaultNextOffsetMin?: number; suggestStatus?: string; suggestLostReason?: string }

interface Preset {
  outcomes: OutcomeDef[];
  statuses: { name: string; kind: 'open' | 'won' | 'lost'; color?: string; requiresFields?: string[] }[];
  lostReasons: string[];
  customFields: { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'boolean'; options?: string[] }[];
}

const COMMON_OUTCOMES: OutcomeDef[] = [
  { label: 'Connected - Interested', kind: 'connected', requiresNextAction: true, defaultNextOffsetMin: 1440, suggestStatus: '__interested' },
  { label: 'Connected - Callback', kind: 'connected', requiresNextAction: true },
  { label: 'Connected - Not Interested', kind: 'connected', requiresNextAction: false, suggestStatus: '__lost', suggestLostReason: 'Not interested' },
  { label: 'Not Reachable', kind: 'not_connected', requiresNextAction: true, defaultNextOffsetMin: 1440 },
  { label: 'Busy', kind: 'not_connected', requiresNextAction: true, defaultNextOffsetMin: 120 },
  { label: 'Wrong Number', kind: 'dead', requiresNextAction: false, suggestStatus: '__lost', suggestLostReason: 'Wrong number' },
  { label: 'DND', kind: 'dead', requiresNextAction: false, suggestStatus: '__lost' },
];

export const PRESETS: Record<string, Preset> = {
  generic: {
    outcomes: COMMON_OUTCOMES,
    statuses: [
      { name: 'New', kind: 'open' }, { name: 'Contacted', kind: 'open' }, { name: 'Qualified', kind: 'open' },
      { name: 'Won', kind: 'won' }, { name: 'Lost', kind: 'lost' },
    ],
    lostReasons: ['Not interested', 'Wrong number', 'Price', 'Went to competitor', 'No response'],
    customFields: [],
  },
  real_estate: {
    outcomes: COMMON_OUTCOMES,
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
    outcomes: COMMON_OUTCOMES,
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
  const statuses: any[] = await repos.statuses.find({}, { sort: { position: 1 } });
  const interested = statuses.find((x) => /interested|qualified|counselling/i.test(x.name)) ?? statuses.find((x) => x.kind === 'open' && x.position > 0);
  const lost = statuses.find((x) => x.kind === 'lost');
  const sid = (k?: string) => (k === '__interested' ? interested?._id : k === '__lost' ? lost?._id : undefined);
  await repos.outcomes.createMany(p.outcomes.map((o) => ({ label: o.label, kind: o.kind, requiresNextAction: o.requiresNextAction, defaultNextOffsetMin: o.defaultNextOffsetMin, suggestStatusId: sid(o.suggestStatus), suggestLostReasonLabel: o.suggestLostReason, active: true })));
  await repos.sources.createMany([{ kind: 'manual', name: 'Manual entry' }, { kind: 'import', name: 'Import' }, { kind: 'api', name: 'API' }]);
}
