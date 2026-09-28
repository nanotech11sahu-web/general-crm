import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Agency layer — sub-accounts + cross-workspace rollup (Phase 11 core DoD)', () => {
  it('creates an agency, spins up 2 sub-accounts, and returns a rollup report covering all of them', async () => {
    const { token } = await createOwnerContext('Agency HQ');

    const agencyRes = await request(app).post('/api/agency').set('Authorization', `Bearer ${token}`).send({ name: 'Acme Agency' });
    expect(agencyRes.status).toBe(201);

    const sub1 = await request(app).post('/api/agency/sub-accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Client One' });
    const sub2 = await request(app).post('/api/agency/sub-accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Client Two' });
    expect(sub1.status).toBe(201);
    expect(sub2.status).toBe(201);

    const rollup = await request(app).get('/api/agency/rollup').set('Authorization', `Bearer ${token}`);
    expect(rollup.status).toBe(200);
    expect(rollup.body.subAccountCount).toBe(3); // agency HQ workspace + 2 sub-accounts
    const names = rollup.body.workspaces.map((w: { name: string }) => w.name);
    expect(names).toEqual(expect.arrayContaining(['Agency HQ', 'Client One', 'Client Two']));
    expect(rollup.body.totals).toBeDefined();
  });

  it('blocks a non-owner workspace from managing sub-accounts', async () => {
    const { token } = await createOwnerContext('Standalone Co');
    const res = await request(app).post('/api/agency/sub-accounts').set('Authorization', `Bearer ${token}`).send({ name: 'Nope' });
    expect(res.status).toBe(404); // not part of an agency at all
  });
});
