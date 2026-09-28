import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Staff } from '../models/Staff';

const app = createApp();

describe('Onboarding checklist — recomputed live from real module signals (Phase 11 core DoD)', () => {
  it('already reflects the seeded demo contact and default pipeline as complete, and unlocks more as real objects are created', async () => {
    const { token, workspace } = await createOwnerContext();

    const first = await request(app).get('/api/workspaces/onboarding').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(30);
    const byKey = (key: string) => first.body.tasks.find((t: { key: string }) => t.key === key);
    expect(byKey('workspace_created').completed).toBe(true);
    expect(byKey('first_contact').completed).toBe(true); // seeded demo contact
    expect(byKey('first_pipeline').completed).toBe(true); // seeded default pipeline
    expect(byKey('staff_added').completed).toBe(false);

    await Staff.create({ workspaceId: workspace._id, name: 'New Hire', email: 'newhire@example.com' });

    const second = await request(app).get('/api/workspaces/onboarding').set('Authorization', `Bearer ${token}`);
    const staffTask = second.body.tasks.find((t: { key: string }) => t.key === 'staff_added');
    expect(staffTask.completed).toBe(true);
    expect(second.body.completed).toBeGreaterThan(first.body.completed);
  });
});

describe('Notification center — HRM leave approvals (Phase 11 core DoD)', () => {
  it('notifies the workspace owner when a leave request needs approval', async () => {
    const { token, workspace } = await createOwnerContext();
    const staff = await Staff.create({ workspaceId: workspace._id, name: 'Leave Taker', email: 'leave@example.com' });

    await request(app)
      .post('/api/hrm/leave')
      .set('Authorization', `Bearer ${token}`)
      .send({ staffId: String(staff._id), type: 'Sick', startDate: new Date().toISOString(), endDate: new Date().toISOString() });

    const notifications = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(notifications.body.notifications.some((n: { type: string }) => n.type === 'operations.leavePending')).toBe(true);
  });
});
