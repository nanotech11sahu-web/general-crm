import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

/** Normalise to E.164 using the tenant's default country; null if invalid. */
export function normalizePhone(raw: string, defaultCountry: string = 'IN'): string | null {
  const p = parsePhoneNumberFromString(raw.trim(), defaultCountry as CountryCode);
  return p && p.isValid() ? p.number : null;
}

/** `98••••••12` style masking for agent UIs (custody). */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, '');
  if (d.length <= 4) return '••••';
  return `${d.slice(0, 2)}${'•'.repeat(d.length - 4)}${d.slice(-2)}`;
}
