import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Webinars', () => {
  it('shows Zoom as not connected until the connect stub is invoked', async () => {
    const { token } = await createOwnerContext();
    const before = await request(app).get('/api/webinars/zoom-status').set('Authorization', `Bearer ${token}`);
    expect(before.body.connected).toBe(false);

    const connect = await request(app).post('/api/webinars/zoom-connect').set('Authorization', `Bearer ${token}`);
    expect(connect.body.connected).toBe(true);

    const after = await request(app).get('/api/webinars/zoom-status').set('Authorization', `Bearer ${token}`);
    expect(after.body.connected).toBe(true);
  });

  it('creates a webinar through the wizard fields and issues a join link', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/webinars')
      .set('Authorization', `Bearer ${token}`)
      .send({
        topic: 'Product Launch Webinar',
        description: 'Launching our new feature',
        scheduleType: 'one_time',
        startAt: new Date(Date.now() + 86400000).toISOString(),
        durationMinutes: 45,
        options: { requireRegistration: true, enableRecording: true, altHostEmails: ['co-host@example.com'] },
        registration: { mode: 'built_in' },
      });
    expect(res.status).toBe(201);
    expect(res.body.webinar.status).toBe('draft');
    expect(res.body.webinar.joinLink).toMatch(/^https:\/\/meet\.pmc-demo\.local/);
    expect(res.body.webinar.options.altHostEmails).toEqual(['co-host@example.com']);
  });

  it('filters webinars by status and supports Recover-bin delete', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app)
      .post('/api/webinars')
      .set('Authorization', `Bearer ${token}`)
      .send({ topic: 'Draft Webinar', startAt: new Date(Date.now() + 86400000).toISOString() });

    await request(app).patch(`/api/webinars/${created.body.webinar._id}`).set('Authorization', `Bearer ${token}`).send({ status: 'scheduled' });

    const scheduled = await request(app).get('/api/webinars?status=scheduled').set('Authorization', `Bearer ${token}`);
    expect(scheduled.body.webinars).toHaveLength(1);

    const del = await request(app).delete(`/api/webinars/${created.body.webinar._id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
  });
});
