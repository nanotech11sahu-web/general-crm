import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalKeyService, sealSecret } from '@leaddesk/crypto';
import { migrateUp, runWithTenant, runAsSystem, newObjectId } from '@leaddesk/db';

let rs: MongoMemoryReplSet; let app: INestApplication; let http: any; let db: any;
const jobs: any[] = [];
const secret = 'whsec_test_123456';
let publicId: string; let tenantId: string; let connId: string;
const sign = (b: string) => 'sha256=' + createHmac('sha256', secret).update(b).digest('hex');

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = rs.getUri('ingress_test');
  const kek = randomBytes(32);
  process.env.LOCAL_KEK_BASE64 = kek.toString('base64');
  const c = await MongoClient.connect(process.env.MONGO_URL); await migrateUp(c.db()); await c.close();
  const { IngressModule } = await import('../src/ingress.module');
  const { INBOX_QUEUE } = await import('../src/inbox-queue');
  const { TENANT_DB } = await import('@leaddesk/platform');
  const mod = await Test.createTestingModule({ imports: [IngressModule] })
    .overrideProvider(INBOX_QUEUE).useValue({ enqueue: async (j: any) => { jobs.push(j); } }).compile();
  app = mod.createNestApplication({ rawBody: true });
  await app.init();
  http = app.getHttpServer();
  db = mod.get(TENANT_DB);
  const tenant: any = await runAsSystem('test', () => db.models.Tenant.create({ name: 'T', slug: 't' }));
  tenantId = String(tenant._id);
  connId = String(newObjectId());
  publicId = 'pub_' + randomBytes(8).toString('hex');
  const sealed = await sealSecret(new LocalKeyService(kek), { tenantId, connectionId: connId }, JSON.stringify({ signingSecret: secret }));
  await runWithTenant(tenantId, () => db.repos.connections.create({
    _id: connId, provider: 'website-webhook', category: 'lead_source', name: 'site', publicId, status: 'verified',
    secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef, secretHint: sealed.hint,
  }));
});
afterAll(async () => { await app?.close(); await rs?.stop(); });

const post = (body: string, headers: Record<string, string>) =>
  request(http).post(`/hooks/website-webhook/${publicId}`).set('Content-Type', 'application/json').set(headers).send(body);

describe('webhook ingress', () => {
  it('rejects bad/missing signature with 401 and stores nothing', async () => {
    const body = JSON.stringify({ id: 'L1', name: 'A' });
    await post(body, { 'x-event-id': 'e-bad', 'x-signature-256': 'sha256=' + '0'.repeat(64) }).expect(401);
    await post(body, { 'x-event-id': 'e-none' }).expect(401);
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count())).toBe(0);
  });
  it('404s for unknown public id, wrong provider, and GET', async () => {
    await request(http).post('/hooks/website-webhook/nope').send('{}').expect(404);
    await request(http).post(`/hooks/meta/${publicId}`).send('{}').expect(404);
    await request(http).get(`/hooks/website-webhook/${publicId}`).expect(404);
  });
  it('replaying the same webhook 5x yields exactly 1 inbox row and 1 job', async () => {
    const body = JSON.stringify({ id: 'L2', name: 'B', phone: '9876543210' });
    for (let i = 0; i < 5; i++) await post(body, { 'x-event-id': 'e-replay', 'x-signature-256': sign(body) }).expect(200);
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count({ externalEventId: 'e-replay' }))).toBe(1);
    expect(jobs.filter((j) => j.tenantId === tenantId)).toHaveLength(1);
    const row: any = await runWithTenant(tenantId, () => db.repos.inbox.findOne({ externalEventId: 'e-replay' }));
    expect(row.rawPayload.id).toBe('L2');
    expect(row.signatureValid).toBe(true);
  });
  it('concurrent duplicates are still idempotent', async () => {
    const body = JSON.stringify({ id: 'L3' });
    await Promise.all(Array.from({ length: 10 }, () => post(body, { 'x-event-id': 'e-conc', 'x-signature-256': sign(body) })));
    expect(await runWithTenant(tenantId, () => db.repos.inbox.count({ externalEventId: 'e-conc' }))).toBe(1);
  });
  it('acks fast', async () => {
    const body = JSON.stringify({ id: 'L4' });
    const t = Date.now();
    await post(body, { 'x-event-id': 'e-fast', 'x-signature-256': sign(body) }).expect(200);
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('meta app-level webhook', () => {
  const APP_SECRET = 'meta-app-secret';
  const msign = (b: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(b).digest('hex');
  const change = (id: string, page = 'PAGE1') => ({ field: 'leadgen', value: { leadgen_id: id, page_id: page, form_id: 'f', created_time: 1 } });
  const body = (...ids: string[]) => JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', time: 1, changes: ids.map((i) => change(i)) }] });
  let metaTenant: string; let otherTenant: string;

  beforeAll(async () => {
    process.env.META_APP_SECRET = APP_SECRET; process.env.META_WEBHOOK_VERIFY_TOKEN = 'vt-123';
    const mkT = async (slug: string) => String(((await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug }))) as any)._id);
    metaTenant = await mkT('meta-t'); otherTenant = await mkT('meta-o');
    for (const [t, name, pages] of [[metaTenant, 'Meta A', ['PAGE1', 'PAGE2']], [otherTenant, 'Other', ['PAGE9']]] as const)
      await runWithTenant(t, () => db.repos.connections.create({ provider: 'meta-leadads', category: 'lead_source', name, publicId: `m-${name}`, status: 'verified', config: { pageIds: pages } }));
  });
  const metaPost = (b: string, headers: Record<string, string> = {}) => request(http).post('/hooks/meta-leadads').set('Content-Type', 'application/json').set(headers).send(b);

  it('needs the Meta app credentials to even exist: provider not registered without them', async () => {
    // registry in this suite was built before META_* were set, so the connector is absent => 404 (not an open endpoint)
    await metaPost(body('L1'), { 'x-hub-signature-256': msign(body('L1')) }).expect(404);
  });
  it('with the provider registered: handshake, signature, routing by page, idempotency', async () => {
    const { createRegistry } = await import('@leaddesk/connectors');
    const { REGISTRY } = await import('../src/hooks.controller');
    const m2 = await Test.createTestingModule({ imports: [(await import('../src/ingress.module')).IngressModule] })
      .overrideProvider((await import('../src/inbox-queue')).INBOX_QUEUE).useValue({ enqueue: async (j: any) => { jobs.push(j); } })
      .overrideProvider(REGISTRY).useValue(createRegistry({ META_APP_ID: 'APP1', META_APP_SECRET: APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: 'vt-123' } as any)).compile();
    const app2 = m2.createNestApplication({ rawBody: true }); await app2.init();
    const h2 = app2.getHttpServer();
    const post = (b: string, headers: Record<string, string> = {}) => request(h2).post('/hooks/meta-leadads').set('Content-Type', 'application/json').set(headers).send(b);
    try {
      await request(h2).get('/hooks/meta-leadads').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-123', 'hub.challenge': '777' }).expect(200).expect('777');
      await request(h2).get('/hooks/meta-leadads').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '777' }).expect(403);
      await post(body('L1')).expect(401);
      await post(body('L1'), { 'x-hub-signature-256': msign('different body') }).expect(401);
      const before = jobs.length;
      const b = body('L10', 'L11');
      expect((await post(b, { 'x-hub-signature-256': msign(b) }).expect(200)).body.accepted).toBe(2);
      for (let i = 0; i < 4; i++) await post(b, { 'x-hub-signature-256': msign(b) }).expect(200); // Meta retries
      expect(jobs.length - before).toBe(2);
      expect(await runWithTenant(metaTenant, () => db.repos.inbox.count({ provider: 'meta-leadads' }))).toBe(2);
      const row: any = await runWithTenant(metaTenant, () => db.repos.inbox.findOne({ externalEventId: 'L10' }));
      expect(row.rawPayload).toMatchObject({ leadgen_id: 'L10', page_id: 'PAGE1' });
      // a page nobody connected: still 200 (never let Meta disable the webhook) but nothing stored
      const unk = JSON.stringify({ object: 'page', entry: [{ id: 'PX', changes: [change('Z1', 'PX')] }] });
      expect((await post(unk, { 'x-hub-signature-256': msign(unk) }).expect(200)).body.accepted).toBe(0);
      // another tenant's page never receives this tenant's leads
      expect(await runWithTenant(otherTenant, () => db.repos.inbox.count())).toBe(0);
      // non-leadgen change types and other objects are ignored
      const feed = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: {} }] }] });
      expect((await post(feed, { 'x-hub-signature-256': msign(feed) }).expect(200)).body.accepted).toBe(0);
      // app-level provider cannot be hit through the per-connection route
      await request(h2).post('/hooks/meta-leadads/m-Meta%20A').set('Content-Type', 'application/json').send('{}').expect(404);
    } finally { await app2.close(); }
  });
});

describe('whatsapp app-level + sms token webhooks', () => {
  const APP_SECRET = 'wa-app-secret';
  const wsign = (b: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(b).digest('hex');
  let exoPub: string; let waTenant: string; let smsConnPublic: string; let smsTenant: string; let kekB: Buffer;
  const body = (...msgs: any[]) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'PN1' }, contacts: [{ wa_id: '919800000001', profile: { name: 'Anita' } }], messages: msgs.filter((m) => m.text), statuses: msgs.filter((m) => m.status) } }, { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 'tp1', message_template_name: 'welcome', message_template_language: 'en' } }] }] });

  beforeAll(async () => {
    process.env.META_APP_SECRET = APP_SECRET; process.env.META_WEBHOOK_VERIFY_TOKEN = 'wvt';
    const mkT = async (slug: string) => String(((await runAsSystem('test', () => db.models.Tenant.create({ name: slug, slug }))) as any)._id);
    waTenant = await mkT('wa-t'); smsTenant = await mkT('sms-t');
    await runWithTenant(waTenant, () => db.repos.connections.create({ provider: 'whatsapp-cloud', category: 'whatsapp', name: 'WA', publicId: 'wa-pub', status: 'verified', config: { wabaId: 'WABA1', phoneNumberId: 'PN1' } }));
    kekB = randomBytes(32); // the suite's key service uses the env KEK; seal with it
    const id = String(newObjectId()); smsConnPublic = 'sms-pub-' + randomBytes(4).toString('hex');
    const sealed = await sealSecret(new LocalKeyService(Buffer.from(process.env.LOCAL_KEK_BASE64!, 'base64')), { tenantId: smsTenant, connectionId: id }, JSON.stringify({ authKey: 'k'.repeat(20), webhookToken: 'sms-hook-token' }));
    await runWithTenant(smsTenant, () => db.repos.connections.create({ _id: id, provider: 'sms-msg91', category: 'sms', name: 'SMS', publicId: smsConnPublic, status: 'verified', secretCiphertext: sealed.ciphertext, secretWrappedDek: sealed.wrappedDek, secretKeyRef: sealed.keyRef }));
    void kekB;
    const eid = String(newObjectId()); exoPub = 'exo-pub-' + randomBytes(4).toString('hex');
    const sealedE = await sealSecret(new LocalKeyService(Buffer.from(process.env.LOCAL_KEK_BASE64!, 'base64')), { tenantId: smsTenant, connectionId: eid }, JSON.stringify({ apiKey: 'k', apiToken: 't', webhookToken: 'exo-hook-token' }));
    await runWithTenant(smsTenant, () => db.repos.connections.create({ _id: eid, provider: 'telephony-exotel', category: 'voice', name: 'Exotel', publicId: exoPub, status: 'verified', secretCiphertext: sealedE.ciphertext, secretWrappedDek: sealedE.wrappedDek, secretKeyRef: sealedE.keyRef }));
  });

  it('routes WhatsApp messages/statuses by phone number and template updates by WABA; idempotent; signed; handshake', async () => {
    const { createRegistry } = await import('@leaddesk/connectors');
    const { REGISTRY } = await import('../src/hooks.controller');
    const m2 = await Test.createTestingModule({ imports: [(await import('../src/ingress.module')).IngressModule] })
      .overrideProvider((await import('../src/inbox-queue')).INBOX_QUEUE).useValue({ enqueue: async (j: any) => { jobs.push(j); } })
      .overrideProvider(REGISTRY).useValue(createRegistry({ META_APP_ID: 'APP1', META_APP_SECRET: APP_SECRET, META_WEBHOOK_VERIFY_TOKEN: 'wvt' } as any)).compile();
    const app2 = m2.createNestApplication({ rawBody: true }); await app2.init(); const h2 = app2.getHttpServer();
    const post = (b: string, headers: Record<string, string> = {}) => request(h2).post('/hooks/whatsapp-cloud').set('Content-Type', 'application/json').set(headers).send(b);
    try {
      await request(h2).get('/hooks/whatsapp-cloud').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wvt', 'hub.challenge': '42' }).expect(200).expect('42');
      await request(h2).get('/hooks/whatsapp-cloud').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '42' }).expect(403);
      const b = body({ from: '919800000001', id: 'wamid.A', timestamp: '1773120000', type: 'text', text: { body: 'hello' } }, { id: 'wamid.OUT', status: 'delivered' });
      await post(b).expect(401);
      await post(b, { 'x-hub-signature-256': wsign('tampered') }).expect(401);
      expect((await post(b, { 'x-hub-signature-256': wsign(b) }).expect(200)).body.accepted).toBe(3); // message + status + template update
      for (let i = 0; i < 3; i++) await post(b, { 'x-hub-signature-256': wsign(b) }).expect(200);   // Meta retries
      const rows = (await runWithTenant(waTenant, () => db.repos.inbox.find({ provider: 'whatsapp-cloud' }))) as any[];
      expect(rows.map((r) => r.externalEventId).sort()).toEqual(['status:wamid.OUT:delivered', 'tpl:tp1:APPROVED', 'wamid.A']);
      expect(rows.find((r) => r.externalEventId === 'wamid.A').rawPayload).toMatchObject({ kind: 'message', profileName: 'Anita', from: '919800000001' });
      // numbers nobody connected are acknowledged but stored nowhere
      const unk = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WX', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'NOPE' }, messages: [{ from: '1', id: 'z', timestamp: '1', type: 'text', text: { body: 'x' } }] } }] }] });
      expect((await post(unk, { 'x-hub-signature-256': wsign(unk) }).expect(200)).body.accepted).toBe(0);
      expect(await runWithTenant(smsTenant, () => db.repos.inbox.count())).toBe(0);
      await request(h2).post('/hooks/whatsapp-cloud/wa-pub').set('Content-Type', 'application/json').send('{}').expect(404);
    } finally { await app2.close(); }
  });

  it('SMS delivery reports need the shared token (query or header) and are stored once', async () => {
    const path = `/hooks/sms-msg91/${smsConnPublic}`;
    const payload = JSON.stringify([{ request_id: 'req-9', status: '1' }]);
    const send = (q: string, headers: Record<string, string> = {}) => request(http).post(path + q).set('Content-Type', 'application/json').set(headers).send(payload);
    await send('').expect(401);
    await send('?token=wrong').expect(401);
    await send('', { 'x-webhook-token': 'nope' }).expect(401);
    expect(await runWithTenant(smsTenant, () => db.repos.inbox.count())).toBe(0);
    await send('?token=sms-hook-token').expect(200);
    await send('', { 'x-webhook-token': 'sms-hook-token' }).expect(200);
    expect(await runWithTenant(smsTenant, () => db.repos.inbox.count({ externalEventId: 'req-9:1' }))).toBe(1);
  });

  it('Exotel call callbacks arrive form-encoded: token required, decoded into the stored payload, deduped per call+status', async () => {
    const path = `/hooks/telephony-exotel/${exoPub}`;
    const send = (q: string, form: string) => request(http).post(path + q).set('Content-Type', 'application/x-www-form-urlencoded').send(form);
    const form = 'CallSid=cs-1&Status=completed&ConversationDuration=61';
    await send('', form).expect(401);
    await send('?token=wrong', form).expect(401);
    await send('?token=exo-hook-token', form).expect(200);
    await send('?token=exo-hook-token', form).expect(200); // redelivery
    const rows: any[] = await runWithTenant(smsTenant, () => db.repos.inbox.find({ externalEventId: 'cs-1:completed' }));
    expect(rows).toHaveLength(1);
    expect(rows[0].rawPayload).toMatchObject({ CallSid: 'cs-1', Status: 'completed', ConversationDuration: '61' });
  });
});
