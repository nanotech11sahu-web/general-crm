import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { createWorkspaceForOwner } from '../services/workspace.service';
import { signAccessToken } from '../lib/jwt';

export async function createOwnerContext(workspaceName = 'Test Workspace') {
  const user = await User.create({
    name: 'Test Owner',
    email: `owner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    passwordHash: await bcrypt.hash('password123', 10),
  });
  const { workspace, membership, pipeline, demoContact } = await createWorkspaceForOwner(user._id, workspaceName);
  const token = signAccessToken({
    sub: String(user._id),
    workspaceId: String(workspace._id),
    membershipId: String(membership._id),
  });
  return { user, workspace, membership, pipeline, demoContact, token };
}
