import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('AI Social', () => {
  it('rejects posting to a channel that is not connected', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/ai-social/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hello world', channels: ['instagram'], mode: 'publish' });
    expect(res.status).toBe(400);
  });

  it('connects a channel then allows publishing a post to it', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/ai-social/channels/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'instagram' });
    const res = await request(app)
      .post('/api/ai-social/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hello world', channels: ['instagram'], mode: 'publish' });
    expect(res.status).toBe(201);
    expect(res.body.post.status).toBe('published');
  });

  it('saves a post as draft without requiring the channel to be connected', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/ai-social/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Draft idea', channels: ['linkedin'], mode: 'draft' });
    expect(res.status).toBe(201);
    expect(res.body.post.status).toBe('draft');
  });

  it('computes the delivery-health funnel and KPIs on the dashboard', async () => {
    const { token } = await createOwnerContext();
    await request(app).post('/api/ai-social/channels/connect').set('Authorization', `Bearer ${token}`).send({ platform: 'instagram' });
    await request(app)
      .post('/api/ai-social/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Post 1', channels: ['instagram'], mode: 'publish' });
    await request(app)
      .post('/api/ai-social/posts')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Post 2', channels: ['instagram'], mode: 'draft' });

    const dashboard = await request(app).get('/api/ai-social/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.deliveryFunnel.published).toBe(1);
    expect(dashboard.body.deliveryFunnel.draft).toBe(1);
    expect(dashboard.body.connectionHealth.connected).toBe(1);
  });
});
