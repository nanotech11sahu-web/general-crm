import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Sales Performance', () => {
  it('aggregates verified revenue, calls, and actions into the leaderboard', async () => {
    const { token, membership } = await createOwnerContext();

    await request(app).post('/api/sales-performance/activities').set('Authorization', `Bearer ${token}`).send({ type: 'revenue', amount: 5000 });
    await request(app).post('/api/sales-performance/activities').set('Authorization', `Bearer ${token}`).send({ type: 'revenue', amount: 2500 });
    await request(app).post('/api/sales-performance/activities').set('Authorization', `Bearer ${token}`).send({ type: 'call' });
    await request(app).post('/api/sales-performance/activities').set('Authorization', `Bearer ${token}`).send({ type: 'action' });
    await request(app).post('/api/sales-performance/activities').set('Authorization', `Bearer ${token}`).send({ type: 'response', responseTimeSeconds: 120 });

    const leaderboard = await request(app).get('/api/sales-performance/leaderboard').set('Authorization', `Bearer ${token}`);
    expect(leaderboard.status).toBe(200);
    const row = leaderboard.body.leaderboard.find((r: { membershipId: string }) => r.membershipId === String(membership._id));
    expect(row.verifiedRevenue).toBe(7500);
    expect(row.callsMade).toBe(1);
    expect(row.totalActions).toBe(2); // 1 action + 1 call
    expect(row.avgResponseSeconds).toBe(120);
    expect(row.activeNow).toBe(true);

    const overview = await request(app).get('/api/sales-performance/overview').set('Authorization', `Bearer ${token}`);
    expect(overview.body.kpis.verifiedRevenue).toBe(7500);
  });

  it('saves per-staff incentive settings', async () => {
    const { token, membership } = await createOwnerContext();
    const res = await request(app)
      .put('/api/sales-performance/incentive-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ membershipId: String(membership._id), incentiveAmount: 1500, notes: 'Q1 bonus' });
    expect(res.status).toBe(200);
    expect(res.body.setting.incentiveAmount).toBe(1500);

    const list = await request(app).get('/api/sales-performance/incentive-settings').set('Authorization', `Bearer ${token}`);
    expect(list.body.settings).toHaveLength(1);
  });
});
