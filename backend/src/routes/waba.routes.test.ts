import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('WABA setup, compliance, and inbound opt-out', () => {
  it('starts not connected for a new workspace', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/waba/dashboard').set('Authorization', `Bearer ${token}`);
    expect(res.body.account.status).toBe('not_connected');
  });

  it('completes setup with an onboarding type and billing mode against the shared wallet', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/waba/setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ onboardingType: 'own_number', billingMode: 'credit_line' });
    expect(res.status).toBe(200);
    expect(res.body.account.status).toBe('connected');
    expect(res.body.account.onboardingType).toBe('own_number');
  });

  it('an inbound STOP message registers in the opt-in registry and blocks future workflow sends', async () => {
    const { token, demoContact } = await createOwnerContext();
    const inbound = await request(app)
      .post('/api/waba/inbound')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), text: 'STOP' });
    expect(inbound.body.optedOut).toBe(true);

    const registry = await request(app).get('/api/waba/opt-outs').set('Authorization', `Bearer ${token}`);
    expect(registry.body.optOuts).toHaveLength(1);
  });

  it('skips opt-out processing when auto opt-out is disabled', async () => {
    const { token, demoContact } = await createOwnerContext();
    await request(app).patch('/api/waba/compliance').set('Authorization', `Bearer ${token}`).send({ autoOptOutEnabled: false });
    const inbound = await request(app)
      .post('/api/waba/inbound')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id), text: 'STOP' });
    expect(inbound.body.optedOut).toBe(false);
  });

  it('creates a template in pending_approval status and approves it', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/waba/templates').set('Authorization', `Bearer ${token}`).send({ name: 'Order Update', body: 'Your order shipped!' });
    expect(created.body.template.status).toBe('pending_approval');
    const approved = await request(app).post(`/api/waba/templates/${created.body.template._id}/approve`).set('Authorization', `Bearer ${token}`);
    expect(approved.body.template.status).toBe('approved');
  });
});
