import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { DeletedItem } from '../models/DeletedItem';

const app = createApp();

describe('Custom Fields CRUD + soft-delete routing (Phase 0 engine, Phase 12 coverage pass)', () => {
  it('creates, filters by objectType, edits, and soft-deletes a field through Deleted Items', async () => {
    const { token } = await createOwnerContext();

    const create = await request(app)
      .post('/api/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ objectType: 'Contact', label: 'Referral Source', type: 'single_line' });
    expect(create.status).toBe(201);
    const fieldId = create.body.field._id;

    const listAll = await request(app).get('/api/custom-fields').set('Authorization', `Bearer ${token}`);
    expect(listAll.body.fields).toHaveLength(1);

    const listFiltered = await request(app).get('/api/custom-fields').query({ objectType: 'Project' }).set('Authorization', `Bearer ${token}`);
    expect(listFiltered.body.fields).toHaveLength(0);

    const edit = await request(app).patch(`/api/custom-fields/${fieldId}`).set('Authorization', `Bearer ${token}`).send({ label: 'Lead Source' });
    expect(edit.status).toBe(200);
    expect(edit.body.field.label).toBe('Lead Source');

    const del = await request(app).delete(`/api/custom-fields/${fieldId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const deletedItems = await DeletedItem.find({ originalCollection: 'CustomField' }).lean();
    expect(deletedItems).toHaveLength(1);
    expect(deletedItems[0].snapshot.label).toBe('Lead Source');

    const editMissing = await request(app).patch(`/api/custom-fields/${fieldId}`).set('Authorization', `Bearer ${token}`).send({ label: 'x' });
    expect(editMissing.status).toBe(404);

    const deleteMissing = await request(app).delete(`/api/custom-fields/${fieldId}`).set('Authorization', `Bearer ${token}`);
    expect(deleteMissing.status).toBe(404);
  });
});
