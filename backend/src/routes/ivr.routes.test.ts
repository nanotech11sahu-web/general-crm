import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('IVR Calling', () => {
  it('dials a number, logs the call, and feeds Sales Performance', async () => {
    const { token } = await createOwnerContext();
    const dial = await request(app).post('/api/ivr/dial').set('Authorization', `Bearer ${token}`).send({ toNumber: '+1 555 0101', source: 'Manual Dial' });
    expect(dial.status).toBe(201);
    expect(dial.body.call.status).toBe('completed');

    const overview = await request(app).get('/api/ivr/overview').set('Authorization', `Bearer ${token}`);
    expect(overview.body.kpis.totalCalls).toBe(1);
    expect(overview.body.kpis.connected).toBe(1);

    const leaderboard = await request(app).get('/api/sales-performance/leaderboard').set('Authorization', `Bearer ${token}`);
    expect(leaderboard.body.leaderboard[0].callsMade).toBe(1);
  });

  it('lists the provider catalog and connects a stub provider', async () => {
    const { token } = await createOwnerContext();
    const before = await request(app).get('/api/ivr/providers').set('Authorization', `Bearer ${token}`);
    expect(before.body.providers.find((p: { key: string }) => p.key === 'callyzer').connected).toBe(false);

    const connect = await request(app).post('/api/ivr/providers/callyzer/connect').set('Authorization', `Bearer ${token}`);
    expect(connect.body.connected).toBe(true);

    const after = await request(app).get('/api/ivr/providers').set('Authorization', `Bearer ${token}`);
    expect(after.body.providers.find((p: { key: string }) => p.key === 'callyzer').connected).toBe(true);
  });

  it('lists staff as agents', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ivr/agents').set('Authorization', `Bearer ${token}`);
    expect(res.body.agents.length).toBeGreaterThanOrEqual(1);
  });
});
