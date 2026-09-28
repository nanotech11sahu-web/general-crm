import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Notification } from '../models/Notification';

const app = createApp();

describe('Notifications — list, mark one read, mark all read (Phase 0/11 engine, Phase 12 coverage pass)', () => {
  it('lists real notifications for the caller only, then marks one and all as read', async () => {
    const { token, workspace, user } = await createOwnerContext();
    const other = await createOwnerContext('Other Workspace');

    const [n1] = await Promise.all([
      Notification.create({ workspaceId: workspace._id, userId: user._id, type: 'test.one', title: 'One', message: 'First' }),
      Notification.create({ workspaceId: workspace._id, userId: user._id, type: 'test.two', title: 'Two', message: 'Second' }),
    ]);
    await Notification.create({ workspaceId: other.workspace._id, userId: other.user._id, type: 'test.other', title: 'Not mine', message: 'x' });

    const list = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.notifications).toHaveLength(2);
    expect(list.body.unreadCount).toBe(2);

    await request(app).post(`/api/notifications/${n1._id}/read`).set('Authorization', `Bearer ${token}`);
    const afterOne = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(afterOne.body.unreadCount).toBe(1);

    await request(app).post('/api/notifications/read-all').set('Authorization', `Bearer ${token}`);
    const afterAll = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`);
    expect(afterAll.body.unreadCount).toBe(0);
  });
});
