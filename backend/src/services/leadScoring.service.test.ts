import { computeLeadScore, recalculateContactScore, recalculateAllContactScores } from './leadScoring.service';
import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { LeadScoreLog } from '../models/LeadScoreLog';

describe('computeLeadScore (pure rules engine)', () => {
  const base = {
    email: undefined as string | undefined,
    phone: undefined as string | undefined,
    company: undefined as string | undefined,
    temperature: 'Cold' as const,
    lifecycleStage: 'Lead' as const,
    leadValue: undefined as number | undefined,
    dnd: { email: false, whatsapp: false, waba: false, calls: false, blockAll: false },
  };
  const emptyContext = { openOpportunityCount: 0, recentTimelineEventCount: 0, notesCount: 0 };

  it('scores a bare-minimum cold contact at 0', () => {
    const result = computeLeadScore(base, emptyContext);
    expect(result.score).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('adds weight for identity fields, temperature, and lifecycle stage', () => {
    const result = computeLeadScore(
      { ...base, email: 'a@b.com', phone: '123', company: 'Acme', temperature: 'Hot', lifecycleStage: 'SQL' },
      emptyContext,
    );
    // email(10) + phone(10) + company(5) + hot(20) + SQL(20) = 65
    expect(result.score).toBe(65);
  });

  it('caps recent-activity weight at 20 regardless of event count', () => {
    const result = computeLeadScore(base, { ...emptyContext, recentTimelineEventCount: 50 });
    expect(result.signals.find((s) => s.key === 'recent_activity')?.weight).toBe(20);
  });

  it('never returns a score above 100 even with every positive signal maxed', () => {
    const result = computeLeadScore(
      { ...base, email: 'a@b.com', phone: '1', company: 'Acme', temperature: 'Hot', lifecycleStage: 'Customer', leadValue: 500 },
      { openOpportunityCount: 5, recentTimelineEventCount: 50, notesCount: 50 },
    );
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('applies a penalty when all channels are blocked (Do Not Disturb)', () => {
    const withoutDnd = computeLeadScore({ ...base, email: 'a@b.com' }, emptyContext);
    const withDnd = computeLeadScore(
      { ...base, email: 'a@b.com', dnd: { ...base.dnd, blockAll: true } },
      emptyContext,
    );
    expect(withDnd.score).toBeLessThan(withoutDnd.score);
  });

  it('never returns a negative score even when penalties exceed positive signals', () => {
    const result = computeLeadScore({ ...base, dnd: { ...base.dnd, blockAll: true } }, emptyContext);
    expect(result.score).toBe(0);
  });
});

describe('recalculateContactScore (persistence + signal log)', () => {
  it('persists the computed score onto the contact and writes a score log entry', async () => {
    const { demoContact } = await createOwnerContext();
    const result = await recalculateContactScore(String(demoContact._id));
    expect(result).not.toBeNull();

    const reloaded = await Contact.findById(demoContact._id).lean();
    expect(reloaded?.leadScore).toBe(result!.score);
    expect(reloaded?.leadScoreUpdatedAt).toBeTruthy();

    const logs = await LeadScoreLog.find({ contactId: demoContact._id });
    expect(logs).toHaveLength(1);
    expect(logs[0].score).toBe(result!.score);
  });

  it('returns null for a contact that does not exist', async () => {
    const result = await recalculateContactScore('64b7f1f1f1f1f1f1f1f1f1f1');
    expect(result).toBeNull();
  });
});

describe('recalculateAllContactScores (nightly cron job logic)', () => {
  it('recalculates every non-archived contact in a workspace and reports the count', async () => {
    const { workspace } = await createOwnerContext();
    const count = await recalculateAllContactScores(String(workspace._id));
    expect(count).toBe(1); // the seeded demo contact

    const contacts = await Contact.find({ workspaceId: workspace._id });
    expect(contacts[0].leadScoreUpdatedAt).toBeTruthy();
  });

  it('skips archived contacts', async () => {
    const { workspace, demoContact } = await createOwnerContext();
    await Contact.findByIdAndUpdate(demoContact._id, { archived: true });
    const count = await recalculateAllContactScores(String(workspace._id));
    expect(count).toBe(0);
  });
});
