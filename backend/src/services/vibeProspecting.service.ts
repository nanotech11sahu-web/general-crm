import crypto from 'crypto';
import { IVibeProspect } from '../models/VibeSearch';

const SAMPLE_FIRST_NAMES = ['Aarav', 'Priya', 'Rohan', 'Ishita', 'Kabir'];
const SAMPLE_LAST_NAMES = ['Mehta', 'Sharma', 'Kapoor', 'Iyer', 'Reddy'];
const SAMPLE_TITLES = ['Founder', 'Head of Growth', 'Marketing Manager', 'Operations Lead', 'CEO'];
const SAMPLE_CITIES = ['Mumbai', 'Bengaluru', 'Delhi', 'Pune', 'Hyderabad'];

const SEARCH_CREDIT_COST = 5;
const RESULTS_PER_SEARCH = 5;

/**
 * Deterministically generates labeled sample prospects for the given query so the
 * feature is demoable without a live external data source. Real provider wiring
 * happens once the AI gateway (Phase 7) is in place.
 */
export function generateProspects(query: string): IVibeProspect[] {
  const seed = crypto.createHash('sha1').update(query.toLowerCase().trim()).digest();
  return Array.from({ length: RESULTS_PER_SEARCH }, (_, i) => {
    const byte = (offset: number) => seed[(i + offset) % seed.length];
    const first = SAMPLE_FIRST_NAMES[byte(0) % SAMPLE_FIRST_NAMES.length];
    const last = SAMPLE_LAST_NAMES[byte(1) % SAMPLE_LAST_NAMES.length];
    const title = SAMPLE_TITLES[byte(2) % SAMPLE_TITLES.length];
    const city = SAMPLE_CITIES[byte(3) % SAMPLE_CITIES.length];
    return {
      id: crypto.randomBytes(6).toString('hex'),
      name: `${first} ${last}`,
      company: `${query.trim().split(/\s+/)[0] || 'Prospect'} ${['Labs', 'Co', 'Group', 'Ventures', 'Studio'][byte(4) % 5]}`,
      city,
      title,
      saved: false,
    };
  });
}

export { SEARCH_CREDIT_COST };
