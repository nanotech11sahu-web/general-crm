import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { signAccessToken } from '../lib/jwt';
import { Membership } from '../models/Membership';
import { Role } from '../models/Role';

const app = createApp();

/**
 * Phase 12 security pass: a systematic IDOR sweep across every module that exposes a
 * `GET /:id`-style detail route. Each case creates a resource in workspace A, then tries
 * to read it using a valid, authenticated token for an entirely different workspace B.
 * Every one of these must come back 404 (resource not found), never 200 (data leak) or
 * a 403 that would confirm the id exists in another tenant.
 */
describe('Security — cross-workspace IDOR sweep (Phase 12 core DoD)', () => {
  const cases: {
    module: string;
    createPath: string;
    createBody: Record<string, unknown>;
    getPath: (id: string) => string;
    idKey: string;
  }[] = [
    { module: 'contacts', createPath: '/api/contacts', createBody: { name: 'Victim Contact', email: 'victim@example.com' }, getPath: (id) => `/api/contacts/${id}`, idKey: 'contact' },
    { module: 'projects', createPath: '/api/projects', createBody: { title: 'Victim Project' }, getPath: (id) => `/api/projects/${id}`, idKey: 'project' },
    { module: 'funnels', createPath: '/api/funnels', createBody: { name: 'Victim Funnel' }, getPath: (id) => `/api/funnels/${id}`, idKey: 'funnel' },
    { module: 'forms', createPath: '/api/forms', createBody: { name: 'Victim Form' }, getPath: (id) => `/api/forms/${id}`, idKey: 'form' },
    { module: 'workflows', createPath: '/api/workflows', createBody: { name: 'Victim Workflow', triggerKey: 'contact.created' }, getPath: (id) => `/api/workflows/${id}`, idKey: 'workflow' },
    { module: 'chat-widgets', createPath: '/api/chat-widgets', createBody: { name: 'Victim Widget' }, getPath: (id) => `/api/chat-widgets/${id}`, idKey: 'widget' },
    { module: 'event-types', createPath: '/api/event-types', createBody: { name: 'Victim Event Type' }, getPath: (id) => `/api/event-types/${id}`, idKey: 'eventType' },
    { module: 'proposals', createPath: '/api/proposals', createBody: { name: 'Victim Proposal' }, getPath: (id) => `/api/proposals/${id}`, idKey: 'proposal' },
    {
      module: 'webinars',
      createPath: '/api/webinars',
      createBody: { topic: 'Victim Webinar', startAt: new Date(Date.now() + 86400000).toISOString() },
      getPath: (id) => `/api/webinars/${id}`,
      idKey: 'webinar',
    },
  ];

  for (const testCase of cases) {
    it(`blocks cross-workspace access to another tenant's ${testCase.module} record`, async () => {
      const { token: victimToken } = await createOwnerContext('Victim Workspace');
      const { token: attackerToken } = await createOwnerContext('Attacker Workspace');

      const created = await request(app).post(testCase.createPath).set('Authorization', `Bearer ${victimToken}`).send(testCase.createBody);
      expect(created.status).toBe(201);
      const id = created.body[testCase.idKey]._id;
      expect(id).toBeTruthy();

      const victimCanRead = await request(app).get(testCase.getPath(id)).set('Authorization', `Bearer ${victimToken}`);
      expect(victimCanRead.status).toBe(200);

      const attackerRead = await request(app).get(testCase.getPath(id)).set('Authorization', `Bearer ${attackerToken}`);
      expect(attackerRead.status).toBe(404);
    });
  }
});

describe('Security — privilege escalation resistance (Phase 12 core DoD)', () => {
  it('a member with zero settings permissions cannot read, create, edit, or delete Roles', async () => {
    const { token: ownerToken } = await createOwnerContext();
    const role = await request(app).post('/api/roles').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'No Settings Access', permissions: {} });
    const invite = await request(app)
      .post('/api/workspaces/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Locked Out', email: 'lockedout@example.com', roleId: role.body.role._id });
    const membership = await Membership.findById(invite.body.membership._id).lean();
    const restrictedToken = signAccessToken({ sub: String(membership!.userId), workspaceId: String(membership!.workspaceId), membershipId: String(membership!._id) });

    const list = await request(app).get('/api/roles').set('Authorization', `Bearer ${restrictedToken}`);
    expect(list.status).toBe(403);

    const create = await request(app).post('/api/roles').set('Authorization', `Bearer ${restrictedToken}`).send({ name: 'Self-Granted Admin', permissions: {} });
    expect(create.status).toBe(403);

    const edit = await request(app)
      .patch(`/api/roles/${role.body.role._id}`)
      .set('Authorization', `Bearer ${restrictedToken}`)
      .send({ permissions: { settings: { edit: true, create: true, delete: true, read: true } } });
    expect(edit.status).toBe(403);

    const del = await request(app).delete(`/api/roles/${role.body.role._id}`).set('Authorization', `Bearer ${restrictedToken}`);
    expect(del.status).toBe(403);
  });

  it('the system Owner role can never be edited or deleted, even by its own owner', async () => {
    const { token: ownerToken, workspace } = await createOwnerContext();
    const role = await Role.findOne({ workspaceId: workspace._id, isSystem: true }).lean();

    const edit = await request(app)
      .patch(`/api/roles/${role!._id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ permissions: { finance: { read: false } } });
    expect(edit.status).toBe(400);

    const del = await request(app).delete(`/api/roles/${role!._id}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(del.status).toBe(400);
  });

  it('a token forged for a membership id that does not exist resolves to zero permissions, not elevated access', async () => {
    const forged = signAccessToken({ sub: '507f1f77bcf86cd799439011', workspaceId: '507f1f77bcf86cd799439012', membershipId: '507f1f77bcf86cd799439013' });
    const res = await request(app).get('/api/contacts').set('Authorization', `Bearer ${forged}`);
    // The JWT signature is valid so authentication succeeds, but resolveEffectivePermissions
    // finds no such Membership and returns an all-false permission map — the forged token
    // cannot be used to read or write anything, which is the actual security property that matters.
    expect(res.status).toBe(403);
  });

  it('rejects requests with no token and with a garbage token', async () => {
    const noAuth = await request(app).get('/api/contacts');
    expect(noAuth.status).toBe(401);

    const garbage = await request(app).get('/api/contacts').set('Authorization', 'Bearer not-a-real-jwt');
    expect(garbage.status).toBe(401);
  });
});
