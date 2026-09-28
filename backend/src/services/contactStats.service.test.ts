import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { getContactStats } from './contactStats.service';

describe('getContactStats (real aggregation pipelines)', () => {
  it('computes KPIs, funnel, and leaderboards from actual contact documents', async () => {
    const { workspace } = await createOwnerContext();

    await Contact.create([
      { workspaceId: workspace._id, name: 'A', source: 'Form', city: 'Mumbai', lifecycleStage: 'SQL' },
      { workspaceId: workspace._id, name: 'B', source: 'Form', city: 'Mumbai', lifecycleStage: 'Customer' },
      { workspaceId: workspace._id, name: 'C', source: 'Referral', city: 'Delhi', lifecycleStage: 'Lead' },
    ]);
    // Demo Lead contact from seeding is also in range with source "Seed".

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const stats = await getContactStats(String(workspace._id), { from, to });

    expect(stats.kpis.newContacts).toBe(4);
    expect(stats.kpis.topCity).toBe('Mumbai');
    expect(stats.sourceLeaderboard.find((s) => s.source === 'Form')?.count).toBe(2);
    expect(stats.funnel.find((f) => f.step === 'Contacts created')?.count).toBe(4);
    expect(stats.funnel.find((f) => f.step === 'Customers')?.count).toBe(1);
    expect(stats.dailySeries.reduce((sum, d) => sum + d.count, 0)).toBe(4);
  });

  it('returns zeroed KPIs for a date range with no contacts', async () => {
    const { workspace } = await createOwnerContext();
    const from = new Date('2000-01-01');
    const to = new Date('2000-01-31');
    const stats = await getContactStats(String(workspace._id), { from, to });
    expect(stats.kpis.newContacts).toBe(0);
    expect(stats.kpis.topSource).toBeNull();
    expect(stats.dailySeries).toHaveLength(0);
  });
});
