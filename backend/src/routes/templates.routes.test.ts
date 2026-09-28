import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Content Templates CRUD (Phase 10, Phase 12 coverage pass)', () => {
  it('creates, filters by category, edits, and deletes a template', async () => {
    const { token } = await createOwnerContext();

    const create = await request(app)
      .post('/api/templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'Email', name: 'Welcome Email', content: 'Hi {{name}}, welcome!' });
    expect(create.status).toBe(201);
    const templateId = create.body.template._id;

    const listAll = await request(app).get('/api/templates').set('Authorization', `Bearer ${token}`);
    expect(listAll.body.templates).toHaveLength(1);
    expect(listAll.body.categories).toContain('Email');

    const listFiltered = await request(app).get('/api/templates').query({ category: 'Notes' }).set('Authorization', `Bearer ${token}`);
    expect(listFiltered.body.templates).toHaveLength(0);

    const edit = await request(app).patch(`/api/templates/${templateId}`).set('Authorization', `Bearer ${token}`).send({ name: 'Updated Welcome' });
    expect(edit.status).toBe(200);
    expect(edit.body.template.name).toBe('Updated Welcome');

    const del = await request(app).delete(`/api/templates/${templateId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const editMissing = await request(app).patch(`/api/templates/${templateId}`).set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(editMissing.status).toBe(404);

    const deleteMissing = await request(app).delete(`/api/templates/${templateId}`).set('Authorization', `Bearer ${token}`);
    expect(deleteMissing.status).toBe(404);
  });
});
