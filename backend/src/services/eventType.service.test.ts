import { computeEventTypeIssues } from './eventType.service';

describe('computeEventTypeIssues', () => {
  const base = {
    name: 'Test',
    durationMinutes: 30,
    availability: [{ day: 1, enabled: true, startTime: '09:00', endTime: '17:00' }],
    requirePayment: false,
    price: 0,
    bookingFormFields: [{ key: 'email', label: 'Email', type: 'email' as const, required: true }],
  };

  it('returns no issues for a valid configuration', () => {
    expect(computeEventTypeIssues(base)).toHaveLength(0);
  });

  it('flags a missing name', () => {
    expect(computeEventTypeIssues({ ...base, name: '' })).toContain('Calendar Details — name is required');
  });

  it('flags zero duration', () => {
    expect(computeEventTypeIssues({ ...base, durationMinutes: 0 })).toContain('Calendar Details — duration must be greater than 0');
  });

  it('flags no enabled availability days', () => {
    expect(computeEventTypeIssues({ ...base, availability: [{ day: 1, enabled: false, startTime: '09:00', endTime: '17:00' }] })).toContain(
      'Schedule & Availability — at least one day must be enabled',
    );
  });

  it('flags payment enabled without a price', () => {
    expect(computeEventTypeIssues({ ...base, requirePayment: true, price: 0 })).toContain('Settings & Payment — a price is required when payment is enabled');
  });

  it('flags a missing email field', () => {
    expect(computeEventTypeIssues({ ...base, bookingFormFields: [] })).toContain('Booking Form Fields — an email field is required');
  });
});
