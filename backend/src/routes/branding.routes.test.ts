import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Branding — white-label change reflected live (Phase 10 core DoD)', () => {
  it('a branding update is immediately visible on the next fetch, as the sidebar would see it', async () => {
    const { token } = await createOwnerContext();

    const before = await request(app).get('/api/branding').set('Authorization', `Bearer ${token}`);
    expect(before.body.branding.primaryColor).toBe('#4f46e5');

    await request(app).patch('/api/branding').set('Authorization', `Bearer ${token}`).send({ primaryColor: '#16a34a', experienceName: 'Acme Workspace' });

    const after = await request(app).get('/api/branding').set('Authorization', `Bearer ${token}`);
    expect(after.body.branding.primaryColor).toBe('#16a34a');
    expect(after.body.branding.experienceName).toBe('Acme Workspace');
  });
});
