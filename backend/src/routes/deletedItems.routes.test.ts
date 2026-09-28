import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Deleted Items — real Recover bin (restore genuinely reinserts the document)', () => {
  it('restoring a deleted tag brings it back into the real Tags collection', async () => {
    const { token } = await createOwnerContext();
    const tag = await request(app).post('/api/tags').set('Authorization', `Bearer ${token}`).send({ name: 'VIP', appliesTo: ['Contact'] });
    await request(app).delete(`/api/tags/${tag.body.tag._id}`).set('Authorization', `Bearer ${token}`);

    const gone = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(gone.body.tags.find((t: { name: string }) => t.name === 'VIP')).toBeUndefined();

    const items = await request(app).get('/api/deleted-items').set('Authorization', `Bearer ${token}`);
    const deletedTag = items.body.items.find((i: { originalCollection: string }) => i.originalCollection === 'Tag');
    expect(deletedTag).toBeTruthy();

    const restore = await request(app).post(`/api/deleted-items/${deletedTag._id}/restore`).set('Authorization', `Bearer ${token}`);
    expect(restore.status).toBe(200);

    const restored = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(restored.body.tags.find((t: { name: string }) => t.name === 'VIP')).toBeTruthy();
  });
});
