import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { AppIntegration } from '../models/AppIntegration';
import { Contact } from '../models/Contact';

const app = createApp();

const CSV = `name,email,phone,company\nJane Prospect,jane@example.com,+15550001,Acme Co\nJohn Buyer,john@example.com,+15550002,Beta Inc`;

describe('Lead Import', () => {
  it('lists all 7 sources with native ones always connected and integration-backed ones gated', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/lead-import/sources').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(7);
    const byKey = Object.fromEntries(res.body.sources.map((s: { key: string }) => [s.key, s]));
    expect(byKey.csv.requiresIntegration).toBe(false);
    expect(byKey.csv.connected).toBe(true);
    expect(byKey.website_forms.requiresIntegration).toBe(false);
    expect(byKey.google_sheets.requiresIntegration).toBe(true);
    expect(byKey.google_sheets.connected).toBe(false);
    expect(byKey.facebook_lead_ads.connected).toBe(false);
  });

  it('imports a CSV file, creating and deduping contacts by email', async () => {
    const { token, workspace } = await createOwnerContext();
    const res = await request(app)
      .post('/api/lead-import/csv')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName: 'leads.csv', content: CSV });
    expect(res.status).toBe(201);
    expect(res.body.createdCount).toBe(2);
    expect(res.body.updatedCount).toBe(0);

    const contact = await Contact.findOne({ workspaceId: workspace._id, email: 'jane@example.com' });
    expect(contact?.name).toBe('Jane Prospect');
    expect(contact?.source).toBe('CSV / Excel Upload');

    // Re-importing the same file should update, not duplicate.
    const res2 = await request(app)
      .post('/api/lead-import/csv')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName: 'leads.csv', content: CSV });
    expect(res2.body.createdCount).toBe(0);
    expect(res2.body.updatedCount).toBe(2);

    const jobsRes = await request(app).get('/api/lead-import/jobs').set('Authorization', `Bearer ${token}`);
    expect(jobsRes.body.jobs).toHaveLength(2);
  });

  it('rejects .xlsx uploads with a clear message instead of silently failing', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/lead-import/csv')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName: 'leads.xlsx', content: 'irrelevant' });
    expect(res.status).toBe(400);
  });

  it('blocks Facebook Lead Ads sync until the integration is connected, then allows it once connected', async () => {
    const { token, workspace } = await createOwnerContext();
    const blocked = await request(app).post('/api/lead-import/facebook-lead-ads/sync').set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(400);

    await AppIntegration.create({ workspaceId: workspace._id, appKey: 'facebook_lead_ads', connected: true });

    const allowed = await request(app).post('/api/lead-import/facebook-lead-ads/sync').set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(201);
    expect(allowed.body.createdCount).toBe(3);
  });

  it('reports a live count of contacts sourced from Forms for the Website Forms card', async () => {
    const { token, workspace } = await createOwnerContext();
    await Contact.create({ workspaceId: workspace._id, name: 'Form Lead', source: 'Form' });
    const res = await request(app).get('/api/lead-import/website-forms/summary').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});
