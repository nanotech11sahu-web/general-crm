import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Projects — Phase 8 core DoD (two-way Contact link)', () => {
  it('links a Project to a Contact, searchable from both the project and the contact', async () => {
    const { token, demoContact } = await createOwnerContext();

    const create = await request(app)
      .post('/api/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Redesign homepage', contactId: String(demoContact._id), priority: 'High', status: 'In Progress' });
    expect(create.status).toBe(201);
    const projectId = create.body.project._id;

    const projectDetail = await request(app).get(`/api/projects/${projectId}`).set('Authorization', `Bearer ${token}`);
    expect(projectDetail.body.project.contactId._id).toBe(String(demoContact._id));

    const contactProjects = await request(app).get(`/api/contacts/${demoContact._id}/projects`).set('Authorization', `Bearer ${token}`);
    expect(contactProjects.body.projects).toHaveLength(1);
    expect(contactProjects.body.projects[0]._id).toBe(projectId);
  });

  it('lists projects filtered by status and supports the 5-column Kanban statuses', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ title: 'A', status: 'Blocked' });
    await request(app).post('/api/projects').set('Authorization', `Bearer ${token}`).send({ title: 'B', status: 'Completed' });

    const blocked = await request(app).get('/api/projects?status=Blocked').set('Authorization', `Bearer ${token}`);
    expect(blocked.body.projects).toHaveLength(1);
    expect(blocked.body.projects[0].title).toBe('A');
  });
});
