import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Funnels (Sites) builder + public page publishing', () => {
  it('creates a funnel with a default draft Home page', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    expect(res.status).toBe(201);
    expect(res.body.funnel.pages).toHaveLength(1);
    expect(res.body.funnel.pages[0].isHome).toBe(true);
    expect(res.body.funnel.pages[0].status).toBe('draft');
  });

  it('is not publicly reachable before any page is published', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    const publicId = created.body.funnel.publicId;

    const publicPage = await request(app).get(`/api/public/funnels/${publicId}/pages/`);
    expect(publicPage.status).toBe(404);
  });

  it('rejects publishing an empty page', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    const pageId = created.body.funnel.pages[0].id;
    const res = await request(app)
      .post(`/api/funnels/${created.body.funnel._id}/pages/${pageId}/publish`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('publishes a page with content and makes it reachable at its public URL', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    const funnelId = created.body.funnel._id;
    const publicId = created.body.funnel.publicId;
    const pageId = created.body.funnel.pages[0].id;

    await request(app)
      .patch(`/api/funnels/${funnelId}/pages/${pageId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ blocks: [{ type: 'heading', content: 'Welcome' }, { type: 'cta', content: 'Book a demo', href: '/book' }] });

    const publish = await request(app)
      .post(`/api/funnels/${funnelId}/pages/${pageId}/publish`)
      .set('Authorization', `Bearer ${token}`);
    expect(publish.status).toBe(200);
    expect(publish.body.funnel.pages[0].status).toBe('active');

    const publicPage = await request(app).get(`/api/public/funnels/${publicId}/pages/`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.page.blocks[0].content).toBe('Welcome');
  });

  it('rejects a new page whose path collides with an existing one', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'Landing Page' });
    const res = await request(app)
      .post(`/api/funnels/${created.body.funnel._id}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Home Again', path: '/' });
    expect(res.status).toBe(400);
  });

  it('lists funnels, edits settings/online-toggle, and soft-deletes into Recover (Phase 12 coverage pass)', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/funnels').set('Authorization', `Bearer ${token}`).send({ name: 'List Me' });
    const funnelId = created.body.funnel._id;

    const list = await request(app).get('/api/funnels').set('Authorization', `Bearer ${token}`);
    expect(list.body.funnels).toHaveLength(1);

    const edit = await request(app)
      .patch(`/api/funnels/${funnelId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Funnel', isOnline: false, settings: { trackingHeader: '<script></script>' } });
    expect(edit.status).toBe(200);
    expect(edit.body.funnel.name).toBe('Renamed Funnel');
    expect(edit.body.funnel.isOnline).toBe(false);
    expect(edit.body.funnel.settings.trackingHeader).toBe('<script></script>');

    const editMissing = await request(app).patch('/api/funnels/000000000000000000000000').set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(editMissing.status).toBe(404);

    const del = await request(app).delete(`/api/funnels/${funnelId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
    const recover = await request(app).get('/api/deleted-items').set('Authorization', `Bearer ${token}`);
    expect(recover.body.items.some((i: { originalCollection: string }) => i.originalCollection === 'Funnel')).toBe(true);
  });

  it('returns 404 for an unknown public funnel id', async () => {
    const res = await request(app).get('/api/public/funnels/does-not-exist');
    expect(res.status).toBe(404);
  });
});
