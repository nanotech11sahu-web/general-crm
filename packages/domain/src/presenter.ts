import { maskPhone, type Role } from '@leaddesk/shared';

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1•••$2');

/**
 * Custody: agents never receive raw or normalised contact values (spec §11.1).
 * Calls and messages go through the platform using the lead id.
 */
export function presentLead(lead: any, role: Role) {
  const full = role !== 'agent';
  const { contacts, phoneNorms: _p, ...rest } = lead;
  return {
    ...rest,
    contacts: (contacts ?? []).map((c: any) => full
      ? { kind: c.kind, value: c.valueNorm, isPrimary: !!c.isPrimary, display: c.kind === 'phone' ? c.valueNorm : c.valueNorm }
      : { kind: c.kind, isPrimary: !!c.isPrimary, display: c.kind === 'phone' ? maskPhone(c.valueNorm) : maskEmail(c.valueNorm) }),
  };
}
