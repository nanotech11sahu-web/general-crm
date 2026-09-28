import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Bulk Campaigns', () => {
  it('creates a draft multi-channel campaign with a real recipient count', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/bulk-campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Diwali Promo', channels: ['email', 'whatsapp'], emailSubject: 'Sale!', message: 'Sale is live!' });
    expect(res.status).toBe(201);
    expect(res.body.campaign.status).toBe('draft');
    expect(res.body.campaign.recipientCount).toBe(1);
  });

  it('sends a campaign to all contacts and marks it completed', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app)
      .post('/api/bulk-campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Blast', channels: ['email'], emailSubject: 'Hey!' });
    const sent = await request(app).post(`/api/bulk-campaigns/${created.body.campaign._id}/send`).set('Authorization', `Bearer ${token}`);
    expect(sent.body.campaign.status).toBe('completed');
    expect(sent.body.campaign.sentCount).toBe(1);
  });

  it('filters campaigns by status', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/bulk-campaigns').set('Authorization', `Bearer ${token}`).send({ name: 'Draft One', channels: ['email'] });
    const res = await request(app).get('/api/bulk-campaigns').query({ status: 'Draft' }).set('Authorization', `Bearer ${token}`);
    expect(res.body.campaigns).toHaveLength(1);
  });
});
