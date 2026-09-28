import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { signAccessToken } from '../lib/jwt';
import { Membership } from '../models/Membership';

const app = createApp();

describe('RBAC depth — a restricted custom role actually blocks module UI/API calls (Phase 10 core DoD)', () => {
  it('lets a restricted role read Leads but blocks Finance reads and writes', async () => {
    const { token: ownerToken } = await createOwnerContext();

    const role = await request(app)
      .post('/api/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Restricted Rep', permissions: { leadManagement: { read: true }, finance: { read: false } } });
    expect(role.status).toBe(201);

    const invite = await request(app)
      .post('/api/workspaces/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Restricted User', email: 'restricted@example.com', roleId: role.body.role._id });
    expect(invite.status).toBe(201);

    const membership = await Membership.findById(invite.body.membership._id).lean();
    const restrictedToken = signAccessToken({ sub: String(membership!.userId), workspaceId: String(membership!.workspaceId), membershipId: String(membership!._id) });

    const contactsRead = await request(app).get('/api/contacts').set('Authorization', `Bearer ${restrictedToken}`);
    expect(contactsRead.status).toBe(200);

    const financeRead = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${restrictedToken}`);
    expect(financeRead.status).toBe(403);

    const financeWrite = await request(app)
      .post('/api/finance/transactions')
      .set('Authorization', `Bearer ${restrictedToken}`)
      .send({ contactId: 'x', amount: 100 });
    expect(financeWrite.status).toBe(403);
  });

  it('an edited role permission takes effect immediately without re-login', async () => {
    const { token: ownerToken } = await createOwnerContext();
    const role = await request(app).post('/api/roles').set('Authorization', `Bearer ${ownerToken}`).send({ name: 'Grows Over Time', permissions: {} });
    const invite = await request(app)
      .post('/api/workspaces/members/invite')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Grower', email: 'grower@example.com', roleId: role.body.role._id });
    const membership = await Membership.findById(invite.body.membership._id).lean();
    const memberToken = signAccessToken({ sub: String(membership!.userId), workspaceId: String(membership!.workspaceId), membershipId: String(membership!._id) });

    const before = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${memberToken}`);
    expect(before.status).toBe(403);

    await request(app).patch(`/api/roles/${role.body.role._id}`).set('Authorization', `Bearer ${ownerToken}`).send({ permissions: { finance: { read: true } } });

    const after = await request(app).get('/api/finance/dashboard').set('Authorization', `Bearer ${memberToken}`);
    expect(after.status).toBe(200);
  });
});
