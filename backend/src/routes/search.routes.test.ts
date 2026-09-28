import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Global search — federates across modules (Phase 11 core DoD)', () => {
  it('returns matching Contacts and Projects for one query', async () => {
    const { token } = await createOwnerContext();

    await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ title: 'Zephyr Launch Plan' });

    const res = await request(app).get('/api/search').query({ q: 'Demo Lead' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.results.some((r: { type: string; label: string }) => r.type === 'Contact' && r.label === 'Demo Lead')).toBe(true);

    const res2 = await request(app).get('/api/search').query({ q: 'Zephyr' }).set('Authorization', `Bearer ${token}`);
    expect(res2.body.results.some((r: { type: string; label: string }) => r.type === 'Project' && r.label === 'Zephyr Launch Plan')).toBe(true);
  });

  it('returns nothing across workspaces (no cross-tenant leakage)', async () => {
    const { token: tokenA } = await createOwnerContext('Workspace A');
    const { token: tokenB } = await createOwnerContext('Workspace B');
    await request(app).post('/api/projects').set('Authorization', `Bearer ${tokenA}`).send({ title: 'Secret Project A' });

    const res = await request(app).get('/api/search').query({ q: 'Secret Project A' }).set('Authorization', `Bearer ${tokenB}`);
    expect(res.body.results).toHaveLength(0);
  });
});
