import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { WorkflowRun } from '../models/WorkflowRun';

const app = createApp();

async function createPublishedWorkflow(
  token: string,
  triggerKey: string,
  actionNode: { kind: string; data: Record<string, unknown> },
) {
  const created = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: `WF ${triggerKey}`, triggerKey });
  const workflowId = created.body.workflow._id;
  const triggerNodeId = created.body.workflow.nodes[0].id;
  const actionNodeId = 'action-1';

  await request(app)
    .patch(`/api/workflows/${workflowId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      nodes: [
        created.body.workflow.nodes[0],
        { id: actionNodeId, kind: actionNode.kind, position: { x: 300, y: 150 }, data: actionNode.data },
      ],
      edges: [{ id: 'e1', source: triggerNodeId, target: actionNodeId }],
    });

  const publish = await request(app).post(`/api/workflows/${workflowId}/publish`).set('Authorization', `Bearer ${token}`);
  return { workflowId, publishStatus: publish.status };
}

describe('Workflow builder CRUD, linting, and publish gate', () => {
  it('creates a workflow with a seeded trigger node', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'My Flow', triggerKey: 'contact.created' });
    expect(res.status).toBe(201);
    expect(res.body.workflow.nodes).toHaveLength(1);
    expect(res.body.workflow.nodes[0].kind).toBe('trigger');
  });

  it('reports the full trigger taxonomy including unwired future-phase triggers', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/workflows/triggers').set('Authorization', `Bearer ${token}`);
    expect(res.body.triggers.length).toBeGreaterThan(50);
    expect(res.body.triggers.some((t: { wired: boolean }) => t.wired)).toBe(true);
    expect(res.body.triggers.some((t: { wired: boolean }) => !t.wired)).toBe(true);
  });

  it('lints an empty workflow as having issues and blocks publish', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Empty', triggerKey: 'contact.created' });
    const get = await request(app).get(`/api/workflows/${created.body.workflow._id}`).set('Authorization', `Bearer ${token}`);
    expect(get.body.issues.length).toBeGreaterThan(0);

    const publish = await request(app).post(`/api/workflows/${created.body.workflow._id}/publish`).set('Authorization', `Bearer ${token}`);
    expect(publish.status).toBe(400);
  });

  it('publishes cleanly once a trigger is connected to a fully-configured action', async () => {
    const { token } = await createOwnerContext();
    const { publishStatus } = await createPublishedWorkflow(token, 'contact.created', { kind: 'add_tag', data: { tagName: 'Newsletter' } });
    expect(publishStatus).toBe(200);
  });

  it('flags an action node missing required config as an issue', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Bad config', triggerKey: 'contact.created' });
    const triggerNodeId = created.body.workflow.nodes[0].id;
    await request(app)
      .patch(`/api/workflows/${created.body.workflow._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        nodes: [created.body.workflow.nodes[0], { id: 'a1', kind: 'add_tag', position: { x: 0, y: 0 }, data: {} }],
        edges: [{ id: 'e1', source: triggerNodeId, target: 'a1' }],
      });
    const get = await request(app).get(`/api/workflows/${created.body.workflow._id}`).set('Authorization', `Bearer ${token}`);
    expect(get.body.issues.some((i: string) => i.includes('missing a tag name'))).toBe(true);
  });
});

describe('Real triggers firing end-to-end into published workflows (Phase 4 core DoD)', () => {
  it('1) Contact Created -> tags the contact', async () => {
    const { token } = await createOwnerContext();
    await createPublishedWorkflow(token, 'contact.created', { kind: 'add_tag', data: { tagName: 'New Signup' } });

    const created = await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Auto Tagged', email: 'auto@example.com' });
    await new Promise((r) => setTimeout(r, 50));

    const contact = await Contact.findById(created.body.contact._id).populate('tagIds');
    expect((contact!.tagIds as unknown as { name: string }[]).some((t) => t.name === 'New Signup')).toBe(true);
  });

  it('2) Form Submitted -> tags the resulting contact', async () => {
    const { token, workspace } = await createOwnerContext();
    await createPublishedWorkflow(token, 'form.submitted', { kind: 'add_tag', data: { tagName: 'From Form' } });

    const form = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Lead Capture' });
    await request(app).patch(`/api/forms/${form.body.form._id}`).set('Authorization', `Bearer ${token}`).send({ status: 'published' });
    await request(app)
      .post(`/api/public/forms/${form.body.form._id}/submit`)
      .send({ data: { name: 'Form Person', email: 'formperson@example.com' } });
    await new Promise((r) => setTimeout(r, 50));

    const contact = await Contact.findOne({ workspaceId: workspace._id, email: 'formperson@example.com' }).populate('tagIds');
    expect((contact!.tagIds as unknown as { name: string }[]).some((t) => t.name === 'From Form')).toBe(true);
  });

  it('3) Pipeline Stage Changed (opportunity move) -> sends an email', async () => {
    const { token, pipeline, demoContact } = await createOwnerContext();
    await createPublishedWorkflow(token, 'contact.stageChanged', { kind: 'send_email', data: { subject: 'Congrats on moving forward!' } });

    const opps = await request(app).get('/api/opportunities').query({ pipelineId: String(pipeline._id) }).set('Authorization', `Bearer ${token}`);
    const opportunityId = opps.body.opportunities.find((o: { contactId: string }) => o.contactId === String(demoContact._id))._id;

    await request(app).patch(`/api/opportunities/${opportunityId}/move`).set('Authorization', `Bearer ${token}`).send({ stageKey: 'negotiation', order: 0 });
    await new Promise((r) => setTimeout(r, 50));

    const runs = await WorkflowRun.find({ contactId: demoContact._id, triggerKey: 'contact.stageChanged' });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].steps[0].status).toBe('success');
  });

  it('4) Lifecycle Stage Changed -> sends a WhatsApp message', async () => {
    const { token, demoContact } = await createOwnerContext();
    await createPublishedWorkflow(token, 'contact.lifecycleStageChanged', { kind: 'send_whatsapp', data: { message: 'Welcome to the next stage!' } });

    await request(app).patch(`/api/contacts/${demoContact._id}`).set('Authorization', `Bearer ${token}`).send({ lifecycleStage: 'Customer' });
    await new Promise((r) => setTimeout(r, 50));

    const runs = await WorkflowRun.find({ contactId: demoContact._id, triggerKey: 'contact.lifecycleStageChanged' });
    expect(runs).toHaveLength(1);
    expect(runs[0].steps[0].kind).toBe('send_whatsapp');
    expect(runs[0].steps[0].status).toBe('success');
  });

  it('5) Tag Added -> updates lifecycle stage', async () => {
    const { token, demoContact } = await createOwnerContext();
    await createPublishedWorkflow(token, 'contact.tagAdded', { kind: 'update_lifecycle_stage', data: { stage: 'MQL' } });

    await request(app).post(`/api/contacts/${demoContact._id}/tags`).set('Authorization', `Bearer ${token}`).send({ tagName: 'Engaged' });
    await new Promise((r) => setTimeout(r, 50));

    const contact = await Contact.findById(demoContact._id);
    expect(contact!.lifecycleStage).toBe('MQL');
  });

  it('does not fire a draft (unpublished) workflow', async () => {
    const { token, workspace } = await createOwnerContext();
    await request(app).post('/api/workflows').set('Authorization', `Bearer ${token}`).send({ name: 'Draft only', triggerKey: 'contact.created' });

    const created = await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Untouched', email: 'untouched@example.com' });
    await new Promise((r) => setTimeout(r, 50));

    const runs = await WorkflowRun.find({ workspaceId: workspace._id, contactId: created.body.contact._id });
    expect(runs).toHaveLength(0);
  });

  it('supports a manual "Run Once" test execution independent of the real trigger', async () => {
    const { token, demoContact } = await createOwnerContext();
    const { workflowId } = await createPublishedWorkflow(token, 'contact.created', { kind: 'add_tag', data: { tagName: 'Manual Run' } });

    const res = await request(app)
      .post(`/api/workflows/${workflowId}/run-once`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id) });
    expect(res.status).toBe(201);
    expect(res.body.run.isTestRun).toBe(true);
    expect(res.body.run.status).toBe('success');
  });
});
