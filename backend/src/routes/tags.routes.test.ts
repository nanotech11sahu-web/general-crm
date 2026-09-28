import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { DeletedItem } from '../models/DeletedItem';

const app = createApp();

describe('Tags CRUD + live usage counts (Phase 0/10 engine, Phase 12 coverage pass)', () => {
  it('creates a tag, applies it to a contact, reflects a live usage count, edits, and soft-deletes', async () => {
    const { token, demoContact } = await createOwnerContext();

    const create = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'VIP', appliesTo: ['Contact'], category: 'Priority' });
    expect(create.status).toBe(201);
    const tagId = create.body.tag._id;

    const beforeUsage = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    const beforeTag = beforeUsage.body.tags.find((t: { _id: string }) => t._id === tagId);
    expect(beforeTag.usageCount).toBe(0);

    await request(app).post(`/api/contacts/${demoContact._id}/tags`).set('Authorization', `Bearer ${token}`).send({ tagName: 'VIP' });

    const afterUsage = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    const afterTag = afterUsage.body.tags.find((t: { _id: string }) => t._id === tagId);
    expect(afterTag.usageCount).toBe(1);

    const edit = await request(app).patch(`/api/tags/${tagId}`).set('Authorization', `Bearer ${token}`).send({ color: '#ff0000' });
    expect(edit.status).toBe(200);
    expect(edit.body.tag.color).toBe('#ff0000');

    const del = await request(app).delete(`/api/tags/${tagId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);
    const deletedItems = await DeletedItem.find({ originalCollection: 'Tag' }).lean();
    expect(deletedItems).toHaveLength(1);

    const editMissing = await request(app).patch(`/api/tags/${tagId}`).set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(editMissing.status).toBe(404);
  });
});
