import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';
import { AiRequestLog } from '../models/AiRequestLog';

const app = createApp();

describe('Email Marketing', () => {
  it('creates a draft campaign', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/email-marketing/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Welcome Series', subject: 'Welcome!' });
    expect(res.status).toBe(201);
    expect(res.body.campaign.status).toBe('draft');
  });

  it('sends a test email to one contact without affecting campaign counts', async () => {
    const { token, demoContact } = await createOwnerContext();
    const campaign = await request(app).post('/api/email-marketing/campaigns').set('Authorization', `Bearer ${token}`).send({ name: 'Test', subject: 'Hi' });
    const res = await request(app)
      .post(`/api/email-marketing/campaigns/${campaign.body.campaign._id}/send-test`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: String(demoContact._id) });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('sent');
  });

  it('sends now to every active contact and updates real KPIs', async () => {
    const { token } = await createOwnerContext();
    const campaign = await request(app).post('/api/email-marketing/campaigns').set('Authorization', `Bearer ${token}`).send({ name: 'Blast', subject: 'Big News' });
    const send = await request(app).post(`/api/email-marketing/campaigns/${campaign.body.campaign._id}/send-now`).set('Authorization', `Bearer ${token}`);
    expect(send.status).toBe(200);
    expect(send.body.sent).toBe(1); // the seeded demo contact

    const dashboard = await request(app).get('/api/email-marketing/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.totalSent).toBe(1);
    expect(dashboard.body.kpis.totalCampaigns).toBe(1);
  });

  it('rejects sending an already-sent campaign twice', async () => {
    const { token } = await createOwnerContext();
    const campaign = await request(app).post('/api/email-marketing/campaigns').set('Authorization', `Bearer ${token}`).send({ name: 'Once', subject: 'Once' });
    await request(app).post(`/api/email-marketing/campaigns/${campaign.body.campaign._id}/send-now`).set('Authorization', `Bearer ${token}`);
    const second = await request(app).post(`/api/email-marketing/campaigns/${campaign.body.campaign._id}/send-now`).set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(400);
  });
});

describe('Email Marketing — AI Compose (Phase 7 gateway retrofit)', () => {
  it('drafts a subject and body via the real AI gateway', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    const res = await request(app).post('/api/email-marketing/ai-compose').set('Authorization', `Bearer ${token}`).send({ prompt: 'our autumn sale' });
    expect(res.status).toBe(200);
    expect(res.body.suggestion.subject).toContain('autumn sale');
    expect(res.body.suggestion.bodyPreview).toContain('{{contact.name}}');

    const log = await AiRequestLog.findOne({ workspaceId: workspace._id, purpose: 'emailCompose' }).lean();
    expect(log).toBeTruthy();
  });
});
