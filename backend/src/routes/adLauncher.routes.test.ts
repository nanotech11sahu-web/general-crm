import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Ad Launcher connect flow', () => {
  it('shows a not-connected empty state before any platform is connected', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ad-launcher/accounts').set('Authorization', `Bearer ${token}`);
    expect(res.body.accounts).toHaveLength(0);
  });

  it('connects a Meta account through the mock OAuth flow', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/ad-launcher/accounts/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'meta' });
    expect(res.status).toBe(200);
    expect(res.body.account.status).toBe('connected');
    expect(res.body.account.externalAccountId).toMatch(/^mock-meta-/);
  });

  it('disconnects a connected account', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/ad-launcher/accounts/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'google' });
    const res = await request(app).post('/api/ad-launcher/accounts/google/disconnect').set('Authorization', `Bearer ${token}`);
    expect(res.body.account.status).toBe('not_connected');
  });
});
