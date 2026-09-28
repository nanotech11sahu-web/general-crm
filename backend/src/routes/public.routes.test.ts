import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

async function createPublishedForm(token: string, overrides: Record<string, unknown> = {}) {
  const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Public Form' });
  const formId = created.body.form._id;
  await request(app)
    .patch(`/api/forms/${formId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'published', settings: { skipContactCreation: true, ...overrides } });
  return formId;
}

describe('Public routes — unauthenticated surfaces (Phase 12 coverage + security pass)', () => {
  it('serves a published form and rejects an unpublished/unknown one', async () => {
    const { token } = await createOwnerContext();
    const formId = await createPublishedForm(token);

    const ok = await request(app).get(`/api/public/forms/${formId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.form.name).toBe('Public Form');

    const draft = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Draft Form' });
    const draftRes = await request(app).get(`/api/public/forms/${draft.body.form._id}`);
    expect(draftRes.status).toBe(404);

    const unknown = await request(app).get('/api/public/forms/000000000000000000000000');
    expect(unknown.status).toBe(404);
  });

  it('accepts a valid submission and blocks a GDPR-required submission without consent', async () => {
    const { token } = await createOwnerContext();
    const formId = await createPublishedForm(token, { gdprConsent: true });

    const noConsent = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: { name: 'Jane' } });
    expect(noConsent.status).toBe(400);

    const withConsent = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: { name: 'Jane', consent: true } });
    expect(withConsent.status).toBe(201);
  });

  it('blocks submission without the not-a-robot checkbox when captcha is required', async () => {
    const { token } = await createOwnerContext();
    const formId = await createPublishedForm(token, { requireCaptcha: true });

    const blocked = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: {} });
    expect(blocked.status).toBe(400);

    const allowed = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: {}, notARobot: true });
    expect(allowed.status).toBe(201);
  });

  it('rate-limits repeated submissions from the same IP once the per-hour cap is hit (Phase 12 security DoD)', async () => {
    const { token } = await createOwnerContext();
    const formId = await createPublishedForm(token, { rateLimitPerHour: 2 });

    const first = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: {} });
    const second = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: {} });
    const third = await request(app).post(`/api/public/forms/${formId}/submit`).send({ data: {} });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
  });

  it('rate-limits repeated booking attempts on the same event type from the same IP (Phase 12 security DoD)', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/event-types').set('Authorization', `Bearer ${token}`).send({ name: 'Rate Limited Call' });
    const publicId = created.body.eventType.publicId;
    await request(app).post(`/api/event-types/${created.body.eventType._id}/publish`).set('Authorization', `Bearer ${token}`);

    const attempt = () => request(app).post(`/api/public/booking/${publicId}/book`).send({ startAt: 'bad', endAt: 'bad', formResponses: {} });

    const results = [];
    for (let i = 0; i < 21; i++) results.push(await attempt());
    expect(results.slice(0, 20).every((r) => r.status !== 429)).toBe(true);
    expect(results[20].status).toBe(429);
  });

  it('serves a published funnel and its pages publicly, 404s on unknown/unpublished ones', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Public Funnel' });
    const funnelId = created.body.funnel._id;
    const publicId = created.body.funnel.publicId;
    const homePageId = created.body.funnel.pages.find((p: { isHome: boolean }) => p.isHome).id;

    await request(app)
      .patch(`/api/funnels/${funnelId}/pages/${homePageId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: [{ type: 'heading', content: 'Welcome' }] });
    await request(app).post(`/api/funnels/${funnelId}/pages/${homePageId}/publish`).set('Authorization', `Bearer ${token}`);

    const funnelRes = await request(app).get(`/api/public/funnels/${publicId}`);
    expect(funnelRes.status).toBe(200);
    expect(funnelRes.body.funnel.name).toBe('Public Funnel');

    const pageRes = await request(app).get(`/api/public/funnels/${publicId}/pages/`);
    expect(pageRes.status).toBe(200);

    const unknownFunnel = await request(app).get('/api/public/funnels/does-not-exist');
    expect(unknownFunnel.status).toBe(404);
  });
});
