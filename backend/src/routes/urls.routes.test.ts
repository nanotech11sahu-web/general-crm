import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('URLs (link shortener with domain hard-gate)', () => {
  it('blocks link creation until a domain exists', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/urls/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl: 'https://example.com', domainId: '64b7f1f1f1f1f1f1f1f1f1f1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/i);
  });

  it('reports hasDomain: false on the links list before any domain is added', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/urls/links').set('Authorization', `Bearer ${token}`);
    expect(res.body.hasDomain).toBe(false);
  });

  it('allows link creation once a domain is added, and returns hasDomain: true afterward', async () => {
    const { token } = await createOwnerContext();
    const domain = await request(app).post('/api/urls/domains').set('Authorization', `Bearer ${token}`).send({ hostname: 'pmc.link' });

    const link = await request(app)
      .post('/api/urls/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl: 'https://example.com/landing', domainId: domain.body.domain._id, utm: { source: 'newsletter' } });
    expect(link.status).toBe(201);
    expect(link.body.publicUrl).toContain('pmc.link');

    const list = await request(app).get('/api/urls/links').set('Authorization', `Bearer ${token}`);
    expect(list.body.hasDomain).toBe(true);
    expect(list.body.links).toHaveLength(1);
  });

  it('verifies a domain', async () => {
    const { token } = await createOwnerContext();
    const domain = await request(app).post('/api/urls/domains').set('Authorization', `Bearer ${token}`).send({ hostname: 'brand.co' });
    const verified = await request(app).post(`/api/urls/domains/${domain.body.domain._id}/verify`).set('Authorization', `Bearer ${token}`);
    expect(verified.body.domain.verified).toBe(true);
  });

  it('computes real dashboard KPIs from stored links', async () => {
    const { token } = await createOwnerContext();
    const domain = await request(app).post('/api/urls/domains').set('Authorization', `Bearer ${token}`).send({ hostname: 'pmc.link' });
    await request(app)
      .post('/api/urls/links')
      .set('Authorization', `Bearer ${token}`)
      .send({ destinationUrl: 'https://example.com', domainId: domain.body.domain._id });

    const dashboard = await request(app).get('/api/urls/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.totalLinks).toBe(1);
    expect(dashboard.body.kpis.domains).toBe(1);
  });
});
