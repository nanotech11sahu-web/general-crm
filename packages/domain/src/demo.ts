import { getContext, requireTenantId, toObjectId, type TenantDb } from '@leaddesk/db';
import { DomainError } from './errors';
import { LeadService } from './lead-service';
import { PrivacyService } from './privacy';

const DAY = 86_400_000, HOUR = 3_600_000;
export const DEMO_TAG = 'demo';
/** Fictional numbers in 99999 000xx: obviously sample data, and the platform refuses to message or call any lead tagged `demo`. */
const SAMPLE: { name: string; city: string; src: 'fb' | 'web' | 'sheet'; campaign?: string; stage: 'new' | 'contacted' | 'qualified' | 'won' | 'lost'; budget?: string }[] = [
  { name: 'Anita Deshmukh', city: 'Pune', src: 'fb', campaign: 'Summer Launch', stage: 'new', budget: '85 lakh' }, { name: 'Rahul Mehta', city: 'Mumbai', src: 'fb', campaign: 'Summer Launch', stage: 'new', budget: '1.2 crore' },
  { name: 'Priya Nair', city: 'Thane', src: 'web', stage: 'new', budget: '70 lakh' }, { name: 'Karan Malhotra', city: 'Delhi', src: 'fb', campaign: 'Festive Offer', stage: 'new' },
  { name: 'Sneha Kulkarni', city: 'Nashik', src: 'sheet', stage: 'new', budget: '55 lakh' }, { name: 'Imran Shaikh', city: 'Pune', src: 'web', stage: 'new', budget: '90 lakh' },
  { name: 'Divya Iyer', city: 'Bengaluru', src: 'fb', campaign: 'Festive Offer', stage: 'new' }, { name: 'Vikram Singh', city: 'Nagpur', src: 'sheet', stage: 'new' },
  { name: 'Meera Joshi', city: 'Pune', src: 'fb', campaign: 'Summer Launch', stage: 'contacted', budget: '95 lakh' }, { name: 'Arjun Reddy', city: 'Hyderabad', src: 'web', stage: 'contacted', budget: '1.5 crore' },
  { name: 'Neha Gupta', city: 'Delhi', src: 'fb', campaign: 'Festive Offer', stage: 'contacted' }, { name: 'Sameer Khan', city: 'Mumbai', src: 'sheet', stage: 'contacted', budget: '1 crore' },
  { name: 'Pooja Patil', city: 'Pune', src: 'fb', campaign: 'Summer Launch', stage: 'contacted' }, { name: 'Rohit Bansal', city: 'Surat', src: 'web', stage: 'contacted', budget: '60 lakh' },
  { name: 'Kavita Rao', city: 'Pune', src: 'fb', campaign: 'Summer Launch', stage: 'qualified', budget: '1.1 crore' }, { name: 'Manish Tiwari', city: 'Thane', src: 'web', stage: 'qualified', budget: '80 lakh' },
  { name: 'Shreya Das', city: 'Mumbai', src: 'fb', campaign: 'Festive Offer', stage: 'qualified', budget: '1.4 crore' }, { name: 'Aditya Verma', city: 'Delhi', src: 'sheet', stage: 'qualified' },
  { name: 'Lakshmi Menon', city: 'Pune', src: 'fb', campaign: 'Summer Launch', stage: 'won', budget: '92 lakh' }, { name: 'Deepak Chawla', city: 'Delhi', src: 'web', stage: 'won', budget: '1.3 crore' },
  { name: 'Farhan Ali', city: 'Mumbai', src: 'fb', campaign: 'Festive Offer', stage: 'lost' }, { name: 'Tanvi Shah', city: 'Surat', src: 'web', stage: 'lost' }, { name: 'Gaurav Jain', city: 'Nagpur', src: 'sheet', stage: 'lost' }, { name: 'Ritu Saxena', city: 'Delhi', src: 'fb', campaign: 'Festive Offer', stage: 'lost' },
];
const SOURCES = { fb: { kind: 'meta-leadads', name: 'Facebook ads (sample)' }, web: { kind: 'demo', name: 'Website form (sample)' }, sheet: { kind: 'demo', name: 'Google Sheet (sample)' } } as const;

/** Sample workspace content so a new customer sees a living Today and Pulse in minutes. Fully removable; never contactable. */
export class DemoDataService {
  constructor(private readonly db: TenantDb, private readonly store?: ConstructorParameters<typeof PrivacyService>[1], private readonly now: () => Date = () => new Date()) {}
  private get r() { return this.db.repos; }
  async status() { return { loaded: (await this.r.leads.count({ tags: DEMO_TAG, deletedAt: null })) > 0, leads: await this.r.leads.count({ tags: DEMO_TAG, deletedAt: null }) }; }

  async load() {
    const me = getContext()?.userId; if (!me) throw new DomainError('unauthenticated', 'No acting user', undefined, 401);
    if ((await this.status()).loaded) throw new DomainError('demo_exists', 'Sample data is already loaded', undefined, 409);
    const now = this.now(); const leads = new LeadService(this.db);
    const statuses: any[] = await this.r.statuses.find({}, { sort: { position: 1 } }); const open = statuses.filter((s) => s.kind === 'open'); const won = statuses.find((s) => s.kind === 'won'); const lost = statuses.find((s) => s.kind === 'lost');
    const reasons: any[] = await this.r.lostReasons.find({}); const outcomes: any[] = await this.r.outcomes.find({});
    const stageStatus = (st: string) => st === 'new' ? open[0] : st === 'contacted' ? open[1] ?? open[0] : st === 'qualified' ? open[Math.min(2, open.length - 1)] : st === 'won' ? won : lost;
    let n = 0;
    for (const [i, s] of SAMPLE.entries()) {
      const out: any = await leads.intake({ name: s.name, city: s.city, budgetText: s.budget, campaign: s.campaign, ownerId: me, contacts: [{ value: `99999${String(1000 + i).padStart(5, '0')}` }], source: SOURCES[s.src] } as any);
      if (out.outcome !== 'created') continue; n++;
      const id = toObjectId(out.leadId); const status = stageStatus(s.stage);
      const age = (1 + (i % 6)) * DAY + (i % 5) * HOUR; const contactedAt = new Date(now.getTime() - age + 12 * 60_000);
      const set: Record<string, unknown> = { tags: [DEMO_TAG], statusId: status?._id, score: 30 + ((i * 17) % 65) };
      if (s.stage !== 'new') { set.firstContactedAt = contactedAt; set.lastContactedAt = new Date(now.getTime() - (i % 4) * DAY - HOUR); }
      if (s.stage === 'lost' && lost) set.lostReasonId = reasons[0]?._id;
      await this.r.leads.updateOne({ _id: id }, { $set: set });
      if (s.stage !== 'new') {
        const o = outcomes.find((x) => x.kind === (s.stage === 'lost' ? 'dead' : 'connected')) ?? outcomes[0];
        await this.r.callSessions.create({ leadId: id, agentId: toObjectId(me), state: 'ended', mode: 'tap', startedAt: contactedAt, endedAt: new Date(contactedAt.getTime() + (90 + i * 20) * 1000), durationS: 90 + i * 20, durationSource: 'self_reported', outcomeId: o?._id, outcomeLoggedAt: new Date(contactedAt.getTime() + 5 * 60_000) });
        await this.r.activities.create({ leadId: id, type: 'call_ended', actorId: toObjectId(me), payload: { outcome: o?.label, kind: o?.kind, note: s.stage === 'qualified' ? 'Wants a 3 BHK, visit planned this weekend.' : 'Spoke briefly, interested in pricing.' }, occurredAt: contactedAt });
      }
      // follow-ups: a mix of due soon, later and one overdue, so Today shows every kind of item
      if (s.stage === 'contacted' || s.stage === 'qualified') {
        const due = new Date(now.getTime() + [-3 * HOUR, 10 * 60_000, 3 * HOUR, -HOUR][i % 4]); // overdue, due in 10 minutes, later today, overdue
        const t: any = await this.r.tasks.create({ leadId: id, assigneeId: toObjectId(me), type: 'call', dueAt: due, contextNote: s.stage === 'qualified' ? `Confirm the site visit slot for ${s.name.split(' ')[0]} and share the brochure` : `Call ${s.name.split(' ')[0]} back with the price sheet`, status: 'open', graceMinutes: 15 });
        await this.r.leads.updateOne({ _id: id }, { $set: { nextActionAt: t.dueAt } });
      }
    }
    await this.r.audit.record({ action: 'demo.loaded', entity: 'tenant', entityId: requireTenantId(), meta: { leads: n } });
    return { leads: n };
  }

  /** Removes every sample lead and everything attached to it (no suppression: these numbers are fictional). */
  async clear() {
    const demo: any[] = await this.r.leads.find({ tags: DEMO_TAG }, { projection: { _id: 1 }, limit: 1000 });
    const p = new PrivacyService(this.db, this.store, this.now);
    for (const l of demo) await p.eraseLead(String(l._id), { reason: 'demo cleanup', suppress: false });
    await this.r.sources.deleteMany({ name: { $regex: '\\(sample\\)$' } });
    await this.r.audit.record({ action: 'demo.cleared', entity: 'tenant', entityId: requireTenantId(), meta: { leads: demo.length } });
    return { removed: demo.length };
  }
}
