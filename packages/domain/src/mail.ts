import { runWithTenant, type SystemOps, type TenantDb } from '@leaddesk/db';

/** What the platform needs from an email transport. Implementations: SMTP (platform package), memory (tests), null (not configured). */
export interface Mail { to: string; subject: string; text: string; html?: string }
export interface Mailer { readonly enabled: boolean; send(m: Mail): Promise<{ id?: string }> }

export class NullMailer implements Mailer {
  readonly enabled = false;
  async send(): Promise<{ id?: string }> { return {}; }
}
/** Collects messages instead of sending them: the test double, also used by e2e. */
export class MemoryMailer implements Mailer {
  readonly enabled = true; readonly sent: Mail[] = []; failNext = 0;
  async send(m: Mail) { if (this.failNext > 0) { this.failNext--; throw new Error('smtp down'); } this.sent.push(m); return { id: `mem-${this.sent.length}` }; }
  last() { return this.sent[this.sent.length - 1]; }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** One restrained layout for every message; the text part always carries the same content and the link. */
export function layout(o: { title: string; lines: string[]; cta?: { label: string; url: string }; footer?: string }): { text: string; html: string } {
  const text = [o.title, '', ...o.lines, ...(o.cta ? ['', `${o.cta.label}: ${o.cta.url}`] : []), ...(o.footer ? ['', o.footer] : [])].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#14161a"><div style="max-width:520px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #dfe3ea;border-radius:14px;padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(o.title)}</h1>${o.lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${esc(l)}</p>`).join('')}${o.cta ? `<p style="margin:18px 0"><a href="${esc(o.cta.url)}" style="background:#2358e6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">${esc(o.cta.label)}</a></p><p style="font-size:12px;color:#5d6573;word-break:break-all">${esc(o.cta.url)}</p>` : ''}</div>${o.footer ? `<p style="font-size:12px;color:#5d6573;margin:12px 4px">${esc(o.footer)}</p>` : ''}</div></body></html>`;
  return { text, html };
}

export const emails = {
  passwordReset: (to: string, url: string, minutes: number): Mail => ({ to, subject: 'Reset your LeadDesk password', ...layout({ title: 'Reset your password', lines: [`Use the button below to choose a new password. The link works once and expires in ${minutes} minutes.`, 'If you did not ask for this, you can ignore this email: your password stays as it is.'], cta: { label: 'Choose a new password', url } }) }),
  invitation: (to: string, o: { url: string; workspace: string; inviter?: string; role: string; days: number }): Mail => ({ to, subject: `${o.inviter ?? 'A teammate'} invited you to ${o.workspace} on LeadDesk`, ...layout({ title: `Join ${o.workspace}`, lines: [`${o.inviter ?? 'A teammate'} invited you to ${o.workspace} as ${o.role}.`, `The invitation is valid for ${o.days} days.`], cta: { label: 'Accept the invitation', url: o.url } }) }),
  passwordChanged: (to: string): Mail => ({ to, subject: 'Your LeadDesk password was changed', ...layout({ title: 'Your password was changed', lines: ['Your password was just changed and every other session was signed out.', 'If this was not you, reset your password straight away and contact your workspace owner.'] }) }),
};

/** Notification kinds that also go out by email, who may opt out, and how they read. */
type Eligible = { subject: (p: any) => string; lines: (p: any) => string[]; path: string; category: 'alerts' | 'digest'; essential?: boolean };
const ELIGIBLE: Record<string, Eligible> = {
  'billing.trial_ending': { subject: () => 'Your LeadDesk trial is ending', lines: (p) => [p.text], path: '/billing', category: 'alerts', essential: true },
  'billing.expired': { subject: () => 'Your LeadDesk workspace is read-only', lines: (p) => [p.text, 'Your data is safe and you can still read and export it.'], path: '/billing', category: 'alerts', essential: true },
  'billing.past_due': { subject: () => 'Payment failed for LeadDesk', lines: (p) => [p.text], path: '/billing', category: 'alerts', essential: true },
  'connection.failing': { subject: (p) => `${p.name} stopped working`, lines: (p) => [`The connection “${p.name}” (${p.provider}) is failing.`, ...(p.reasons ?? []).map(String), 'Leads from this source may be missing until it is fixed.'], path: '/settings', category: 'alerts' },
  'connection.revoked': { subject: (p) => `${p.name} was disconnected`, lines: (p) => [`The connection “${p.name}” (${p.provider}) was disconnected by the provider or the account owner.`, 'Reconnect it to keep receiving leads.'], path: '/settings', category: 'alerts' },
  'pulse.digest': { subject: (p) => `Your lead digest for ${p.day}`, lines: (p) => String(p.text ?? '').split('\n').filter(Boolean), path: '/pulse', category: 'digest' },
};
export const isEmailKind = (k: string) => k in ELIGIBLE;

export function emailForNotification(n: { kind: string; payload: any }, to: string, workspace: string, appUrl: string): Mail | null {
  const e = ELIGIBLE[n.kind]; if (!e) return null;
  const url = `${appUrl.replace(/\/$/, '')}${e.path}`;
  return { to, subject: `[${workspace}] ${e.subject(n.payload ?? {})}`, ...layout({ title: e.subject(n.payload ?? {}), lines: e.lines(n.payload ?? {}), cta: { label: 'Open LeadDesk', url }, footer: e.essential ? `You get this because you manage ${workspace}.` : `You get this because of your notification settings in ${workspace}. Change them under Security → Email notices.` }) };
}

export interface EmailPrefs { alerts: boolean; digest: boolean }
export const prefsOf = (m: any): EmailPrefs => ({ alerts: m?.emailPrefs?.alerts !== false, digest: m?.emailPrefs?.digest !== false });

/**
 * Worker sweep: turns unsent notifications into emails. Decoupled from whoever created the notification (API or worker),
 * so a mail outage never blocks the operation that raised it, and a failed send is retried on the next sweep for a day.
 */
export class MailSweeper {
  constructor(private readonly db: TenantDb, private readonly sys: SystemOps, private readonly mailer: Mailer, private readonly appUrl: string, private readonly now: () => Date = () => new Date()) {}

  async runAll(): Promise<{ sent: number; failed: number }> {
    if (!this.mailer.enabled) return { sent: 0, failed: 0 };
    const out = { sent: 0, failed: 0 };
    for (const t of (await this.sys.activeTenants()) as any[]) {
      try { const r = await runWithTenant(String(t._id), () => this.runTenant(t.name)); out.sent += r.sent; out.failed += r.failed; } catch { out.failed++; }
    }
    return out;
  }

  async runTenant(workspace: string): Promise<{ sent: number; failed: number }> {
    const R = this.db.repos; const since = new Date(this.now().getTime() - 24 * 3600_000);
    const pending: any[] = await R.notifications.find({ emailedAt: { $exists: false }, kind: { $in: Object.keys(ELIGIBLE) }, createdAt: { $gte: since } }, { sort: { createdAt: 1 }, limit: 100 });
    if (!pending.length) return { sent: 0, failed: 0 };
    const members: any[] = await R.memberships.find({ status: 'active' });
    const users: any[] = await this.db.models.User.find({ _id: { $in: members.map((m) => m.userId) }, status: 'active' }, { email: 1 }).lean().exec();
    const email = new Map(users.map((u) => [String(u._id), u.email as string]));
    const res = { sent: 0, failed: 0 };
    for (const n of pending) {
      const spec = ELIGIBLE[n.kind];
      const audience = members.filter((m) => n.audience === 'user' ? String(m.userId) === String(n.userId) : n.audience === 'managers' ? ['owner', 'admin', 'manager'].includes(m.role) : ['owner', 'admin'].includes(m.role));
      const to = audience.filter((m) => spec.essential || prefsOf(m)[spec.category]).map((m) => email.get(String(m.userId))).filter((e): e is string => !!e && !(n.emailedTo ?? []).includes(e)); // a retry skips people who already got it
      let failed = false;
      for (const addr of to) {
        const mail = emailForNotification(n, addr, workspace, this.appUrl); if (!mail) continue;
        try { await this.mailer.send(mail); res.sent++; await R.notifications.updateOne({ _id: n._id }, { $addToSet: { emailedTo: addr } }); } catch { failed = true; res.failed++; }
      }
      if (!failed) await R.notifications.updateOne({ _id: n._id }, { $set: { emailedAt: this.now() } }); // nothing to send (everyone opted out) also counts as handled
    }
    return res;
  }
}
