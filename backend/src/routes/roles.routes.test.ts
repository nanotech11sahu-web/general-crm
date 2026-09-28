import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Roles & Leadership Titles (Phase 10, Phase 12 coverage pass)', () => {
  it('lists the seeded system Owner role alongside the module/action catalog', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.roles.some((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
    expect(res.body.modules.length).toBeGreaterThan(0);
    expect(res.body.actions).toEqual(expect.arrayContaining(['read', 'create', 'edit', 'delete']));
  });

  it('creates and lists a leadership title with per-module overrides', async () => {
    const { token } = await createOwnerContext();
    const create = await request(app)
      .post('/api/roles/leadership-titles')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Team Lead', overrides: { leadManagement: { delete: true } } });
    expect(create.status).toBe(201);
    expect(create.body.title.name).toBe('Team Lead');

    const list = await request(app).get('/api/roles/leadership-titles').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.titles).toHaveLength(1);
  });
});
