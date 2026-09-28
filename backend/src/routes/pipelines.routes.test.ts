import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Pipelines CRUD (Phase 1 engine, Phase 12 coverage pass)', () => {
  it('lists the seeded default pipeline, creates a second one, edits, and blocks deleting the default', async () => {
    const { token } = await createOwnerContext();

    const list = await request(app).get('/api/pipelines').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.pipelines).toHaveLength(1);
    const defaultPipeline = list.body.pipelines[0];
    expect(defaultPipeline.isDefault).toBe(true);

    const create = await request(app)
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renewals', stages: [{ key: 'new', label: 'New', order: 0 }] });
    expect(create.status).toBe(201);
    const pipelineId = create.body.pipeline._id;

    const edit = await request(app).patch(`/api/pipelines/${pipelineId}`).set('Authorization', `Bearer ${token}`).send({ name: 'Renewals v2' });
    expect(edit.status).toBe(200);
    expect(edit.body.pipeline.name).toBe('Renewals v2');

    const blockedDelete = await request(app).delete(`/api/pipelines/${defaultPipeline._id}`).set('Authorization', `Bearer ${token}`);
    expect(blockedDelete.status).toBe(400);

    const allowedDelete = await request(app).delete(`/api/pipelines/${pipelineId}`).set('Authorization', `Bearer ${token}`);
    expect(allowedDelete.status).toBe(204);

    const editMissing = await request(app).patch(`/api/pipelines/${pipelineId}`).set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(editMissing.status).toBe(404);
  });
});
