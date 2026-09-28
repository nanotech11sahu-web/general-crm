import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Inbox — real omnichannel merge (Phase 9 core DoD)', () => {
  it('threads a WhatsApp message, a chat-widget message, and an email to the same contact into one conversation', async () => {
    const { token, demoContact } = await createOwnerContext();

    const campaign = await request(app)
      .post('/api/bulk-campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Welcome Blast', channels: ['email', 'whatsapp'], emailSubject: 'Welcome aboard', message: 'Hi there!' });
    await request(app).post(`/api/bulk-campaigns/${campaign.body.campaign._id}/send`).set('Authorization', `Bearer ${token}`);

    await request(app)
      .post(`/api/inbox/conversations/${demoContact._id}/simulate-inbound`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hi, I have a question about pricing' });

    const messages = await request(app).get(`/api/inbox/conversations/${demoContact._id}/messages`).set('Authorization', `Bearer ${token}`);
    expect(messages.status).toBe(200);
    const channels = messages.body.messages.map((m: { channel: string }) => m.channel).sort();
    expect(channels).toEqual(['chatWidget', 'email', 'whatsapp']);

    const conversations = await request(app).get('/api/inbox/conversations').set('Authorization', `Bearer ${token}`);
    const conv = conversations.body.conversations.find((c: { contactId: string }) => c.contactId === String(demoContact._id));
    expect(conv.messageCount).toBe(3);
  });

  it('supports New/Unread/Starred/Snoozed filters', async () => {
    const { token, demoContact } = await createOwnerContext();
    await request(app).post(`/api/inbox/conversations/${demoContact._id}/simulate-inbound`).set('Authorization', `Bearer ${token}`).send({ message: 'Hello' });

    const newConvos = await request(app).get('/api/inbox/conversations?filter=new').set('Authorization', `Bearer ${token}`);
    expect(newConvos.body.conversations).toHaveLength(1);

    await request(app).get(`/api/inbox/conversations/${demoContact._id}/messages`).set('Authorization', `Bearer ${token}`);
    const unreadAfterRead = await request(app).get('/api/inbox/conversations?filter=unread').set('Authorization', `Bearer ${token}`);
    expect(unreadAfterRead.body.conversations).toHaveLength(0);

    await request(app).post(`/api/inbox/conversations/${demoContact._id}/star`).set('Authorization', `Bearer ${token}`).send({ starred: true });
    const starred = await request(app).get('/api/inbox/conversations?filter=starred').set('Authorization', `Bearer ${token}`);
    expect(starred.body.conversations).toHaveLength(1);
  });

  it('lets an agent reply on a channel, creating a real outbound message', async () => {
    const { token, demoContact } = await createOwnerContext();
    const reply = await request(app)
      .post(`/api/inbox/conversations/${demoContact._id}/reply`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'chatWidget', message: 'Thanks for reaching out!' });
    expect(reply.status).toBe(201);
    expect(reply.body.messages).toHaveLength(1);
    expect(reply.body.messages[0].direction).toBe('outbound');
  });
});
