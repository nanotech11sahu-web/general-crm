import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Domain Hub — Feature Domains applied to a real Funnel/Form (Phase 10 core DoD)', () => {
  it('rejects assigning an unverified domain, then applies a verified one onto a real Funnel', async () => {
    const { token } = await createOwnerContext();

    const funnel = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    const domain = await request(app).post('/api/domains').set('Authorization', `Bearer ${token}`).send({ hostname: 'go.example.com' });
    expect(domain.body.domain.verified).toBe(false);

    const blocked = await request(app)
      .post('/api/domains/feature-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ domainId: domain.body.domain._id, feature: 'funnel', targetId: funnel.body.funnel._id });
    expect(blocked.status).toBe(400);

    await request(app).post(`/api/domains/${domain.body.domain._id}/verify`).set('Authorization', `Bearer ${token}`);

    const assign = await request(app)
      .post('/api/domains/feature-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ domainId: domain.body.domain._id, feature: 'funnel', targetId: funnel.body.funnel._id });
    expect(assign.status).toBe(201);

    const updatedFunnel = await request(app).get(`/api/funnels/${funnel.body.funnel._id}`).set('Authorization', `Bearer ${token}`);
    expect(updatedFunnel.body.funnel.settings.domain).toBe('go.example.com');
  });

  it('applies a verified domain onto a real Form', async () => {
    const { token } = await createOwnerContext();
    const form = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Signup Form' });
    const domain = await request(app).post('/api/domains').set('Authorization', `Bearer ${token}`).send({ hostname: 'forms.example.com' });
    await request(app).post(`/api/domains/${domain.body.domain._id}/verify`).set('Authorization', `Bearer ${token}`);

    await request(app)
      .post('/api/domains/feature-assignments')
      .set('Authorization', `Bearer ${token}`)
      .send({ domainId: domain.body.domain._id, feature: 'form', targetId: form.body.form._id });

    const updatedForm = await request(app).get(`/api/forms/${form.body.form._id}`).set('Authorization', `Bearer ${token}`);
    expect(updatedForm.body.form.customDomain).toBe('forms.example.com');
  });
});
