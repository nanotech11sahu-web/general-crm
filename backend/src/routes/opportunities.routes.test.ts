import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Opportunity } from '../models/Opportunity';

const app = createApp();

describe('Opportunities Kanban', () => {
  it('lists the seeded demo opportunity for the default pipeline', async () => {
    const { token, pipeline } = await createOwnerContext();
    const res = await request(app)
      .get('/api/opportunities')
      .query({ pipelineId: String(pipeline._id) })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.opportunities).toHaveLength(1);
    expect(res.body.opportunities[0].stageKey).toBe('qualified');
  });

  it('creates a new opportunity card in a given stage', async () => {
    const { token, pipeline, demoContact } = await createOwnerContext();
    const res = await request(app)
      .post('/api/opportunities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contactId: String(demoContact._id),
        pipelineId: String(pipeline._id),
        stageKey: 'new_lead',
        name: 'Second deal',
      });
    expect(res.status).toBe(201);
    expect(res.body.opportunity.stageKey).toBe('new_lead');
  });

  it('rejects creating an opportunity in an unknown stage', async () => {
    const { token, pipeline, demoContact } = await createOwnerContext();
    const res = await request(app)
      .post('/api/opportunities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contactId: String(demoContact._id),
        pipelineId: String(pipeline._id),
        stageKey: 'not_a_real_stage',
        name: 'Bad deal',
      });
    expect(res.status).toBe(400);
  });

  it('persists a drag-and-drop stage move and logs a timeline event', async () => {
    const { token, pipeline, demoContact } = await createOwnerContext();
    const opp = await Opportunity.findOne({ pipelineId: pipeline._id, contactId: demoContact._id });

    const move = await request(app)
      .patch(`/api/opportunities/${opp!._id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stageKey: 'proposal_sent', order: 0 });
    expect(move.status).toBe(200);
    expect(move.body.opportunity.stageKey).toBe('proposal_sent');

    const reloaded = await Opportunity.findById(opp!._id).lean();
    expect(reloaded?.stageKey).toBe('proposal_sent');

    const timeline = await request(app)
      .get(`/api/contacts/${demoContact._id}/timeline`)
      .set('Authorization', `Bearer ${token}`);
    expect(
      timeline.body.events.some((e: { message: string }) => e.message.includes('proposal_sent')),
    ).toBe(true);
  });

  it('rejects moving an opportunity into a stage that does not belong to its pipeline', async () => {
    const { token, pipeline, demoContact } = await createOwnerContext();
    const opp = await Opportunity.findOne({ pipelineId: pipeline._id, contactId: demoContact._id });
    const move = await request(app)
      .patch(`/api/opportunities/${opp!._id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stageKey: 'made_up_stage', order: 0 });
    expect(move.status).toBe(400);
  });
});
