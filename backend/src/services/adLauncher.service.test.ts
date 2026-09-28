import { createOwnerContext } from '../test/helpers';
import { AdAccount } from '../models/AdAccount';
import { AdCampaign } from '../models/AdCampaign';
import { computeAdHealth, getAdOverview } from './adLauncher.service';

describe('Ad health score (30% active / 40% delivering / 30% with leads)', () => {
  it('is zero with no campaigns', async () => {
    const { workspace } = await createOwnerContext();
    const health = await computeAdHealth(workspace._id);
    expect(health.healthScore).toBe(0);
    expect(health.totalCampaigns).toBe(0);
  });

  it('scores 100 when every campaign is active, delivering, and generating leads', async () => {
    const { workspace } = await createOwnerContext();
    const account = await AdAccount.create({ workspaceId: workspace._id, platform: 'meta', status: 'connected' });
    await AdCampaign.create([
      { workspaceId: workspace._id, adAccountId: account._id, name: 'A', status: 'active', impressions: 100, leads: 5 },
      { workspaceId: workspace._id, adAccountId: account._id, name: 'B', status: 'active', impressions: 50, leads: 2 },
    ]);
    const health = await computeAdHealth(workspace._id);
    expect(health.healthScore).toBe(100);
  });

  it('applies the exact weighted formula for a mixed set of campaigns', async () => {
    const { workspace } = await createOwnerContext();
    const account = await AdAccount.create({ workspaceId: workspace._id, platform: 'meta', status: 'connected' });
    // 1 of 2 active (50%), 1 of 2 delivering (50%), 0 of 2 with leads (0%)
    await AdCampaign.create([
      { workspaceId: workspace._id, adAccountId: account._id, name: 'A', status: 'active', impressions: 100, leads: 0 },
      { workspaceId: workspace._id, adAccountId: account._id, name: 'B', status: 'paused', impressions: 0, leads: 0 },
    ]);
    const health = await computeAdHealth(workspace._id);
    // 0.3*50 + 0.4*50 + 0.3*0 = 35
    expect(health.healthScore).toBe(35);
  });
});

describe('Ad overview aggregation', () => {
  it('computes CPL and CTR from real campaign documents', async () => {
    const { workspace } = await createOwnerContext();
    const account = await AdAccount.create({ workspaceId: workspace._id, platform: 'meta', status: 'connected' });
    await AdCampaign.create({
      workspaceId: workspace._id,
      adAccountId: account._id,
      name: 'Launch',
      status: 'active',
      spend: 1000,
      leads: 10,
      clicks: 200,
      impressions: 10000,
    });
    const overview = await getAdOverview(workspace._id);
    expect(overview.kpis.spend).toBe(1000);
    expect(overview.kpis.cpl).toBe(100);
    expect(overview.kpis.ctr).toBe(2);
  });

  it('avoids divide-by-zero when there are no leads or impressions', async () => {
    const { workspace } = await createOwnerContext();
    const overview = await getAdOverview(workspace._id);
    expect(overview.kpis.cpl).toBe(0);
    expect(overview.kpis.ctr).toBe(0);
  });
});
