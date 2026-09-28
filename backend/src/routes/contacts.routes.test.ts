import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';
import { AiRequestLog } from '../models/AiRequestLog';

const app = createApp();

describe('Contacts CRUD', () => {
  it('lists the seeded demo contact for a new workspace', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .get('/api/contacts')
      .query({ archived: 'false' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.contacts[0].name).toBe('Demo Lead');
  });

  it('creates a contact with custom field values', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Jane Prospect',
        email: 'jane@example.com',
        source: 'Referral',
        customFieldValues: { favoriteColor: 'blue' },
      });
    expect(res.status).toBe(201);
    expect(res.body.contact.name).toBe('Jane Prospect');
    expect(res.body.contact.customFieldValues.favoriteColor).toBe('blue');
  });

  it('rejects contact creation validation failures', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('updates a contact and logs a stage-change timeline event', async () => {
    const { token, demoContact } = await createOwnerContext();
    const res = await request(app)
      .patch(`/api/contacts/${demoContact._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycleStage: 'Customer' });
    expect(res.status).toBe(200);
    expect(res.body.contact.lifecycleStage).toBe('Customer');

    const timeline = await request(app)
      .get(`/api/contacts/${demoContact._id}/timeline`)
      .set('Authorization', `Bearer ${token}`);
    expect(timeline.body.events.some((e: { type: string }) => e.type === 'stage_changed')).toBe(true);
  });

  it('returns 404 for a contact in another workspace', async () => {
    const { token } = await createOwnerContext('Workspace A');
    const other = await createOwnerContext('Workspace B');
    const res = await request(app)
      .get(`/api/contacts/${other.demoContact._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('archives a contact instead of hard-deleting on the archive endpoint', async () => {
    const { token, demoContact } = await createOwnerContext();
    const res = await request(app)
      .post(`/api/contacts/${demoContact._id}/archive`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.contact.archived).toBe(true);
  });

  it('soft-deletes a contact into the Recover bin', async () => {
    const { token, demoContact } = await createOwnerContext();
    const del = await request(app)
      .delete(`/api/contacts/${demoContact._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(204);

    const gone = await request(app)
      .get(`/api/contacts/${demoContact._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(gone.status).toBe(404);

    const recover = await request(app).get('/api/deleted-items').set('Authorization', `Bearer ${token}`);
    expect(recover.body.items.some((i: { originalCollection: string }) => i.originalCollection === 'Contact')).toBe(true);
  });

  it('adds a note to a contact and reflects it on the timeline', async () => {
    const { token, demoContact } = await createOwnerContext();
    const noteRes = await request(app)
      .post(`/api/contacts/${demoContact._id}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Called and left a voicemail.' });
    expect(noteRes.status).toBe(201);

    const timeline = await request(app)
      .get(`/api/contacts/${demoContact._id}/timeline`)
      .set('Authorization', `Bearer ${token}`);
    expect(timeline.body.events.some((e: { type: string }) => e.type === 'note_added')).toBe(true);
  });

  it('rejects requests without a valid auth token', async () => {
    const res = await request(app).get('/api/contacts');
    expect(res.status).toBe(401);
  });

  it('searches and filters by temperature, and paginates with page/limit', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Cold Prospect', email: 'cold@example.com', temperature: 'Cold' });

    const search = await request(app).get('/api/contacts').query({ search: 'Cold Prospect' }).set('Authorization', `Bearer ${token}`);
    expect(search.body.contacts).toHaveLength(1);

    const byTemp = await request(app).get('/api/contacts').query({ temperature: 'Cold' }).set('Authorization', `Bearer ${token}`);
    expect(byTemp.body.contacts).toHaveLength(1);

    const paged = await request(app).get('/api/contacts').query({ page: 1, limit: 1 }).set('Authorization', `Bearer ${token}`);
    expect(paged.body.contacts).toHaveLength(1);
    expect(paged.body.total).toBe(2);
    expect(paged.body.limit).toBe(1);
  });

  it('exposes notes/opportunities/projects/lead-score sub-resources for a contact, and recalculates the score', async () => {
    const { token, demoContact } = await createOwnerContext();

    const notes = await request(app).get(`/api/contacts/${demoContact._id}/notes`).set('Authorization', `Bearer ${token}`);
    expect(notes.status).toBe(200);

    const opportunities = await request(app).get(`/api/contacts/${demoContact._id}/opportunities`).set('Authorization', `Bearer ${token}`);
    expect(opportunities.status).toBe(200);

    const projects = await request(app).get(`/api/contacts/${demoContact._id}/projects`).set('Authorization', `Bearer ${token}`);
    expect(projects.status).toBe(200);

    const score = await request(app).get(`/api/contacts/${demoContact._id}/lead-score`).set('Authorization', `Bearer ${token}`);
    expect(score.status).toBe(200);
    expect(score.body).toHaveProperty('score');

    const recalc = await request(app).post(`/api/contacts/${demoContact._id}/lead-score/recalculate`).set('Authorization', `Bearer ${token}`);
    expect(recalc.status).toBe(200);

    const missingScore = await request(app).get('/api/contacts/000000000000000000000000/lead-score').set('Authorization', `Bearer ${token}`);
    expect(missingScore.status).toBe(404);
  });
});

describe('Contacts — AI Next Best Action (Phase 7 gateway retrofit)', () => {
  it('calls the real AI gateway and grounds the suggestion in the contact\'s real lifecycle stage and score', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    const res = await request(app).post(`/api/contacts/${demoContact._id}/next-best-action`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.suggestion.length).toBeGreaterThan(0);

    const log = await AiRequestLog.findOne({ workspaceId: workspace._id, purpose: 'nextBestAction' }).lean();
    expect(log).toBeTruthy();
    expect(log?.provider).toBe('internal');
  });
});
