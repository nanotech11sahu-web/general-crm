import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Event Type builder (6-step wizard)', () => {
  it('lists the data-driven template catalog across all 7 categories', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/event-types/templates').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toContain('Custom');
    expect(res.body.templates.length).toBeGreaterThan(20);
    expect(res.body.templates.find((t: { key: string }) => t.key === 'scratch')).toBeTruthy();
  });

  it('creates a draft event type from the scratch template with sane defaults', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/event-types')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Discovery Call', templateKey: 'scratch' });
    expect(res.status).toBe(201);
    expect(res.body.eventType.status).toBe('draft');
    expect(res.body.eventType.durationMinutes).toBe(30);
    expect(res.body.eventType.publicId).toBeTruthy();
  });

  it('cannot publish until every wizard step is valid, then publishes once fixed', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app)
      .post('/api/event-types')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Consultation', templateKey: 'scratch' });
    const id = created.body.eventType._id;

    // Step 2: turn off every availability day -> should block publish
    await request(app)
      .patch(`/api/event-types/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: false, startTime: '09:00', endTime: '17:00' })) });

    const failedPublish = await request(app).post(`/api/event-types/${id}/publish`).set('Authorization', `Bearer ${token}`);
    expect(failedPublish.status).toBe(400);

    // Step 2 fix: re-enable Mon-Fri (Save Draft round-trip)
    const fixed = await request(app)
      .patch(`/api/event-types/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ availability: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, enabled: day >= 1 && day <= 5, startTime: '09:00', endTime: '17:00' })) });
    expect(fixed.status).toBe(200);
    expect(fixed.body.issues).toHaveLength(0);

    // Step 4: staff & settings
    await request(app)
      .patch(`/api/event-types/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ locationType: 'zoom', requirePayment: false });

    const publish = await request(app).post(`/api/event-types/${id}/publish`).set('Authorization', `Bearer ${token}`);
    expect(publish.status).toBe(200);
    expect(publish.body.eventType.status).toBe('published');
  });

  it('blocks publish when payment is required but no price is set', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app)
      .post('/api/event-types')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Paid Session', templateKey: 'scratch' });
    const id = created.body.eventType._id;

    const patched = await request(app)
      .patch(`/api/event-types/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ requirePayment: true });
    expect(patched.body.issues).toContain('Settings & Payment — a price is required when payment is enabled');

    const publish = await request(app).post(`/api/event-types/${id}/publish`).set('Authorization', `Bearer ${token}`);
    expect(publish.status).toBe(400);
  });

  it('supports unpublish back to draft', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Quick Chat', templateKey: 'scratch' });
    const id = created.body.eventType._id;
    await request(app).post(`/api/event-types/${id}/publish`).set('Authorization', `Bearer ${token}`);
    const unpublish = await request(app).post(`/api/event-types/${id}/unpublish`).set('Authorization', `Bearer ${token}`);
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.eventType.status).toBe('draft');
  });

  it('deletes an event type into the Recover bin', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'To Delete', templateKey: 'scratch' });
    const id = created.body.eventType._id;
    const del = await request(app).delete(`/api/event-types/${id}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
    const list = await request(app).get('/api/event-types').set('Authorization', `Bearer ${token}`);
    expect(list.body.eventTypes.find((e: { _id: string }) => e._id === id)).toBeUndefined();
  });
});
