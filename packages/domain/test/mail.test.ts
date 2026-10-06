import { describe, expect, it } from 'vitest';
import { emailForNotification, emails, isEmailKind, layout, prefsOf } from '../src';

describe('email rendering', () => {
  it('escapes everything that comes from users and always carries the link in the text part', () => {
    const m = emails.invitation('a@b.co', { url: 'https://app.test/invite/x?a=1&b=2', workspace: '<script>alert(1)</script> Co', inviter: 'Eve "the" boss', role: 'agent', days: 7 });
    expect(m.html).not.toContain('<script>'); expect(m.html).toContain('&lt;script&gt;'); expect(m.html).toContain('a=1&amp;b=2');
    expect(m.text).toContain('https://app.test/invite/x?a=1&b=2'); expect(m.subject).toContain('Eve "the" boss'); // subjects are plain text, not HTML
  });
  it('reset mail states the lifetime and that ignoring it is safe', () => {
    const m = emails.passwordReset('a@b.co', 'https://app.test/reset/t', 60);
    expect(m.text).toMatch(/60 minutes/); expect(m.text).toMatch(/ignore this email/); expect(m.text).toContain('https://app.test/reset/t');
  });
  it('only whitelisted notification kinds become emails; billing is essential, the rest explain how to opt out', () => {
    expect(isEmailKind('billing.expired')).toBe(true); expect(isEmailKind('task.created')).toBe(false);
    expect(emailForNotification({ kind: 'task.created', payload: {} }, 'a@b.co', 'Co', 'https://app.test')).toBeNull();
    const bill = emailForNotification({ kind: 'billing.past_due', payload: { text: 'Payment failed.' } }, 'a@b.co', 'Acme', 'https://app.test/')!;
    expect(bill.subject).toBe('[Acme] Payment failed for LeadDesk'); expect(bill.text).toContain('https://app.test/billing'); expect(bill.text).not.toMatch(/notification settings/);
    const dig = emailForNotification({ kind: 'pulse.digest', payload: { day: '2026-10-05', text: 'line one\nline two' } }, 'a@b.co', 'Acme', 'https://app.test')!;
    expect(dig.text).toMatch(/notification settings/); expect(dig.text).toContain('line two');
  });
  it('preferences default to on and honour explicit off', () => {
    expect(prefsOf(undefined)).toEqual({ alerts: true, digest: true }); expect(prefsOf({ emailPrefs: { digest: false } })).toEqual({ alerts: true, digest: false });
  });
  it('layout never emits raw user text into attributes', () => { expect(layout({ title: 't', lines: ['x'], cta: { label: 'Go', url: 'https://a.b/"onmouseover="x' } }).html).not.toContain('"onmouseover="x'); });
});
