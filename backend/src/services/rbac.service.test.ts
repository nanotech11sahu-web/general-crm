import request from 'supertest';
import { createApp } from '../app';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { Role } from '../models/Role';
import { Membership } from '../models/Membership';
import { LeadershipTitle } from '../models/LeadershipTitle';
import { signAccessToken } from '../lib/jwt';
import { emptyPermissionMap } from '../constants/modules';
import bcrypt from 'bcryptjs';

const app = createApp();

async function makeUserWithRole(roleName: string, permissions = emptyPermissionMap(), isSystem = false) {
  const user = await User.create({
    name: roleName,
    email: `${roleName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    passwordHash: await bcrypt.hash('password123', 10),
  });
  const workspace = await Workspace.create({ name: `${roleName} WS`, slug: `${roleName}-${Date.now()}`, ownerUserId: user._id });
  const role = await Role.create({ workspaceId: workspace._id, name: roleName, isSystem, permissions });
  const membership = await Membership.create({ workspaceId: workspace._id, userId: user._id, roleId: role._id });
  const token = signAccessToken({ sub: String(user._id), workspaceId: String(workspace._id), membershipId: String(membership._id) });
  return { user, workspace, role, membership, token };
}

describe('RBAC across sample roles', () => {
  it('Owner (system role) always has full access regardless of stored permissions', async () => {
    const { token } = await makeUserWithRole('Owner', emptyPermissionMap(), true);
    const res = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const create = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'VIP', appliesTo: ['Contact'] });
    expect(create.status).toBe(201);
  });

  it('a custom role with read-only settings permission can list but not create tags', async () => {
    const perms = emptyPermissionMap();
    perms.settings.read = true;
    const { token } = await makeUserWithRole('Read Only Analyst', perms);
    const list = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const create = await request(app)
      .post('/api/tags')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'VIP', appliesTo: ['Contact'] });
    expect(create.status).toBe(403);
  });

  it('a role with zero permissions is blocked from every action', async () => {
    const { token } = await makeUserWithRole('No Access', emptyPermissionMap());
    const list = await request(app).get('/api/tags').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);
  });

  it('a Leadership Title grants an additive override on top of the base role', async () => {
    const perms = emptyPermissionMap();
    const { workspace, membership } = await makeUserWithRole('Support Rep', perms);
    const title = await LeadershipTitle.create({
      workspaceId: workspace._id,
      name: 'Team Lead',
      overrides: { settings: { read: true, create: true } },
    });
    await Membership.findByIdAndUpdate(membership._id, { $set: { leadershipTitleIds: [title._id] } });

    const newToken = signAccessToken({ sub: String(membership.userId), workspaceId: String(workspace._id), membershipId: String(membership._id) });
    const list = await request(app).get('/api/tags').set('Authorization', `Bearer ${newToken}`);
    expect(list.status).toBe(200);
  });
});
