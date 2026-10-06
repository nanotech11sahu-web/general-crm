import { normalizePhone } from '@leaddesk/shared';

export interface RawContact { kind?: 'phone' | 'email'; value: string }
export interface NormContact { kind: 'phone' | 'email'; valueRaw: string; valueNorm: string; isPrimary: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Phones -> E.164 (tenant default country), emails lowercased. Invalid values are reported, never silently dropped. */
export function normalizeContacts(input: RawContact[], country: string) {
  const out: NormContact[] = [];
  const invalid: { value: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const c of input) {
    const raw = String(c.value ?? '').trim();
    if (!raw) continue;
    const kind = c.kind ?? (raw.includes('@') ? 'email' : 'phone');
    const norm = kind === 'email' ? (EMAIL.test(raw.toLowerCase()) ? raw.toLowerCase() : null) : normalizePhone(raw, country);
    if (!norm) { invalid.push({ value: raw, reason: `invalid ${kind}` }); continue; }
    const key = `${kind}:${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, valueRaw: raw, valueNorm: norm, isPrimary: false });
  }
  const first = out.find((c) => c.kind === 'phone') ?? out[0];
  if (first) first.isPrimary = true;
  return { contacts: out, invalid };
}

/** Search keys for a phone: full E.164, last-10 digits and 4..10-digit suffixes/prefix handled by index. */
export function phoneSearchKeys(e164: string): string[] {
  const d = e164.replace(/\D/g, '');
  const keys = new Set<string>([e164, d]);
  const last10 = d.slice(-10);
  keys.add(last10);
  for (let n = 4; n <= 9; n++) keys.add(`s${last10.slice(-n)}`); // suffixes
  for (let n = 4; n <= 10; n++) keys.add(`p${last10.slice(0, n)}`); // prefixes of national number
  return [...keys];
}

export function cleanName(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}
