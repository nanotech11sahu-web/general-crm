import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Chat Widgets', () => {
  it('creates a widget through the 5-step wizard payload (branding -> theme -> pre-chat -> hours -> routing)', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/chat-widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Support Widget',
        branding: { companyName: 'PMC Demo' },
        theme: { primaryColor: '#4f46e5', position: 'bottom-right' },
        preChat: { greeting: 'Hi! How can we help?', collectName: true, collectEmail: true },
        hours: { alwaysOn: true, timezone: 'Asia/Kolkata' },
        routing: { assignTo: 'round_robin', fallbackMessage: 'We will reply soon.' },
      });
    expect(res.status).toBe(201);
    expect(res.body.widget.status).toBe('draft');
    expect(res.body.widget.branding.companyName).toBe('PMC Demo');
  });

  it('rejects a duplicate widget name within the same workspace', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/chat-widgets').set('Authorization', `Bearer ${token}`).send({ name: 'Dup', branding: { companyName: 'A' } });
    const res = await request(app).post('/api/chat-widgets').set('Authorization', `Bearer ${token}`).send({ name: 'Dup', branding: { companyName: 'B' } });
    expect(res.status).toBe(400);
  });

  it('activates a widget after the wizard completes', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app)
      .post('/api/chat-widgets')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Support Widget', branding: { companyName: 'PMC Demo' } });
    const activated = await request(app)
      .post(`/api/chat-widgets/${created.body.widget._id}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(activated.status).toBe(200);
    expect(activated.body.widget.status).toBe('active');
  });
});
