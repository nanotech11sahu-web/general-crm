import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Contact Stats route', () => {
  it('returns real aggregation stats for the default this-month range', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/contact-stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis).toHaveProperty('newContacts');
  });

  it('honors an explicit from/to range', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .get('/api/contact-stats')
      .query({ from: '2020-01-01', to: '2020-12-31' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.kpis.newContacts).toBe(0); // the seeded demo contact was created "now", not in 2020
  });

  it('is blocked without leadManagement read permission', async () => {
    const res = await request(app).get('/api/contact-stats');
    expect(res.status).toBe(401);
  });
});
