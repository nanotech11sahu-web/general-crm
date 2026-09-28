import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { Contact } from '../models/Contact';
import { TimelineEvent } from '../models/TimelineEvent';
import { creditWallet } from '../services/wallet.service';
import { AiRequestLog } from '../models/AiRequestLog';

const app = createApp();

describe('Forms builder + public submission (end-to-end)', () => {
  it('creates a form with default fields and a unique slug', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Contact Us' });
    expect(res.status).toBe(201);
    expect(res.body.form.slug).toBe('contact-us');
    expect(res.body.form.fields).toHaveLength(3);
  });

  it('de-duplicates slugs within a workspace', async () => {
    const { token } = await createOwnerContext();
    const first = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Contact Us' });
    const second = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Contact Us' });
    expect(first.body.form.slug).toBe('contact-us');
    expect(second.body.form.slug).toBe('contact-us-2');
  });

  it('is not publicly reachable while still a draft', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Draft Form' });
    const publicRes = await request(app).get(`/api/public/forms/${created.body.form._id}`);
    expect(publicRes.status).toBe(404);
  });

  it('a published form can be submitted publicly and creates a real Contact + Timeline event', async () => {
    const { token, workspace } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Lead Capture' });
    const formId = created.body.form._id;

    const published = await request(app)
      .patch(`/api/forms/${formId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'published' });
    expect(published.body.form.status).toBe('published');

    const publicView = await request(app).get(`/api/public/forms/${formId}`);
    expect(publicView.status).toBe(200);
    expect(publicView.body.form.fields.length).toBeGreaterThan(0);

    const submit = await request(app)
      .post(`/api/public/forms/${formId}/submit`)
      .send({ data: { name: 'Jordan Prospect', email: 'jordan@example.com' }, utmSource: 'google' });
    expect(submit.status).toBe(201);

    const contact = await Contact.findOne({ workspaceId: workspace._id, email: 'jordan@example.com' });
    expect(contact).not.toBeNull();
    expect(contact!.source).toBe('Form');

    const events = await TimelineEvent.find({ contactId: contact!._id });
    expect(events.some((e) => e.type === 'form_submitted')).toBe(true);

    const submissions = await request(app)
      .get(`/api/forms/${formId}/submissions`)
      .set('Authorization', `Bearer ${token}`);
    expect(submissions.body.submissions).toHaveLength(1);
  });

  it('reuses an existing contact by email instead of creating a duplicate', async () => {
    const { token, demoContact } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Newsletter' });
    await request(app).patch(`/api/forms/${created.body.form._id}`).set('Authorization', `Bearer ${token}`).send({ status: 'published' });

    await request(app)
      .post(`/api/public/forms/${created.body.form._id}/submit`)
      .send({ data: { name: demoContact.name, email: demoContact.email } });

    const matches = await Contact.find({ email: demoContact.email });
    expect(matches).toHaveLength(1);
  });

  it('rejects submissions once the form is deleted or unpublished', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Unpublished' });
    const res = await request(app)
      .post(`/api/public/forms/${created.body.form._id}/submit`)
      .send({ data: { name: 'X', email: 'x@example.com' } });
    expect(res.status).toBe(404);
  });

  it('enforces the per-IP-per-hour rate limit with a 429', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'Rate Limited' });
    const formId = created.body.form._id;
    await request(app)
      .patch(`/api/forms/${formId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'published', settings: { rateLimitPerHour: 2 } });

    const submitOnce = () =>
      request(app)
        .post(`/api/public/forms/${formId}/submit`)
        .send({ data: { name: 'Repeat', email: `repeat-${Math.random()}@example.com` } });

    await submitOnce();
    await submitOnce();
    const third = await submitOnce();
    expect(third.status).toBe(429);
  });

  it('rejects submission when GDPR consent is required but missing', async () => {
    const { token } = await createOwnerContext();
    const created = await request(app).post('/api/forms').set('Authorization', `Bearer ${token}`).send({ name: 'GDPR Form' });
    await request(app)
      .patch(`/api/forms/${created.body.form._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'published', settings: { gdprConsent: true } });

    const res = await request(app)
      .post(`/api/public/forms/${created.body.form._id}/submit`)
      .send({ data: { name: 'No Consent', email: 'noconsent@example.com' } });
    expect(res.status).toBe(400);
  });
});

describe('Forms — AI Builder (Phase 7 gateway retrofit)', () => {
  it('generates a real form from a prompt via the AI gateway, with prompt-appropriate fields', async () => {
    const { token, workspace } = await createOwnerContext();
    await creditWallet(String(workspace._id), 100, 'top_up');

    const res = await request(app)
      .post('/api/forms/ai-builder')
      .set('Authorization', `Bearer ${token}`)
      .send({ prompt: 'Book a demo call for our B2B company' });
    expect(res.status).toBe(201);
    const fieldTypes = res.body.form.fields.map((f: { type: string }) => f.type);
    expect(fieldTypes).toEqual(expect.arrayContaining(['name', 'email', 'phone', 'short_text', 'submit']));

    const log = await AiRequestLog.findOne({ workspaceId: workspace._id, purpose: 'formBuilder' }).lean();
    expect(log).toBeTruthy();
  });
});
