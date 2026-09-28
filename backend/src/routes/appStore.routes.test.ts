import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('App Store — integration marketplace catalog with real connect state', () => {
  it('lists the full catalog and reflects a real Zoom connection made elsewhere in the app', async () => {
    const { token } = await createOwnerContext();

    const before = await request(app).get('/api/app-store/integrations').set('Authorization', `Bearer ${token}`);
    expect(before.body.integrations.length).toBeGreaterThanOrEqual(15);
    expect(before.body.integrations.find((i: { key: string }) => i.key === 'zoom').connected).toBe(false);

    await request(app).post('/api/webinars/zoom-connect').set('Authorization', `Bearer ${token}`).send({});

    const after = await request(app).get('/api/app-store/integrations').set('Authorization', `Bearer ${token}`);
    expect(after.body.integrations.find((i: { key: string }) => i.key === 'zoom').connected).toBe(true);
  });

  it('connects SMTP for real and a generic catalog entry (IndiaMART) as a connect-state stub', async () => {
    const { token } = await createOwnerContext();

    const smtp = await request(app)
      .post('/api/app-store/integrations/smtp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ host: 'smtp.example.com', port: 587, username: 'user', password: 'secret', fromEmail: 'noreply@example.com' });
    expect(smtp.status).toBe(200);
    expect(smtp.body.connection.passwordMasked.endsWith('et')).toBe(true);

    const connect = await request(app).post('/api/app-store/integrations/indiamart/connect').set('Authorization', `Bearer ${token}`).send({});
    expect(connect.status).toBe(200);

    const integrations = await request(app).get('/api/app-store/integrations').set('Authorization', `Bearer ${token}`);
    expect(integrations.body.integrations.find((i: { key: string }) => i.key === 'smtp').connected).toBe(true);
    expect(integrations.body.integrations.find((i: { key: string }) => i.key === 'indiamart').connected).toBe(true);
  });
});
