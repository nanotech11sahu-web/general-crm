/** Default follow-up time for an outcome, as a `datetime-local` value in the user's timezone. */
export function defaultDue(offsetMinutes?: number | null, now = new Date()): string {
  const d = new Date(now.getTime() + (offsetMinutes && offsetMinutes > 0 ? offsetMinutes : 24 * 60) * 60_000);
  d.setSeconds(0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const toIso = (local: string) => new Date(local).toISOString();
export function countdown(to: string | Date | null | undefined, now = Date.now()): string | null {
  if (!to) return null;
  const s = Math.round((new Date(to).getTime() - now) / 1000);
  if (s <= 0) return 'expired';
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
export const KIND_LABEL: Record<string, string> = { outcome_pending: 'Log outcome', new_lead: 'New lead', overdue_task: 'Overdue', due_task: 'Due soon', inbound: 'Reply', stale: 'Re-engage' };
