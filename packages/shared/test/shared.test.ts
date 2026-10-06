import { describe, expect, it } from 'vitest';
import { can, maskPhone, normalizePhone } from '../src';

describe('phone', () => {
  it('normalises Indian numbers', () => {
    expect(normalizePhone('98765 43210', 'IN')).toBe('+919876543210');
    expect(normalizePhone('+91-9876543210')).toBe('+919876543210');
  });
  it('rejects invalid', () => expect(normalizePhone('12345', 'IN')).toBeNull());
  it('masks', () => expect(maskPhone('+919876543210')).toBe('91••••••••10'));
});
describe('rbac', () => {
  it('agent cannot export; manager can; manager cannot see secrets', () => {
    expect(can('agent', 'leads.export')).toBe(false);
    expect(can('manager', 'leads.export')).toBe(true);
    expect(can('manager', 'connections.manage')).toBe(false);
    expect(can('owner', 'billing.manage')).toBe(true);
  });
});
