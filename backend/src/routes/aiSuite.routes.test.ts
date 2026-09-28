import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';
import { creditWallet } from '../services/wallet.service';

const app = createApp();

async function fundWallet(workspaceId: string) {
  await creditWallet(workspaceId, 1000, 'top_up');
}

describe('AI Suite — Dashboard', () => {
  it('starts at zero and accumulates KPIs after gateway calls', async () => {
    const { token, workspace } = await createOwnerContext();
    await fundWallet(String(workspace._id));

    const before = await request(app).get('/api/ai-suite/dashboard').set('Authorization', `Bearer ${token}`);
    expect(before.body.kpis.totalRequests).toBe(0);

    await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'Test Contact', email: 'test@example.com' });
    const contacts = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    const contactId = contacts.body.contacts[0]._id;
    await request(app).post(`/api/contacts/${contactId}/next-best-action`).set('Authorization', `Bearer ${token}`);

    const after = await request(app).get('/api/ai-suite/dashboard?days=30').set('Authorization', `Bearer ${token}`);
    expect(after.body.kpis.totalRequests).toBeGreaterThanOrEqual(1);
    expect(after.body.kpis.totalTokens).toBeGreaterThan(0);
    expect(after.body.kpis.successRate).toBe(1);
    expect(after.body.tokenUsageChart).toHaveLength(30);
  });
});

describe('AI Suite — AI Brain (Phase 7 core DoD)', () => {
  it('the Finance pack answers a real question grounded in that workspace\'s seeded Finance data', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    await fundWallet(String(workspace._id));

    const product = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Pro Plan', salePrice: 5000 });
    await request(app)
      .post('/api/finance/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product.body.product._id, billingCycle: 'monthly', price: 5000 });

    const chat = await request(app).post('/api/ai-suite/brain/packs/finance/chat').set('Authorization', `Bearer ${token}`).send({ question: 'What is our current MRR?' });
    expect(chat.status).toBe(200);
    expect(chat.body.grounded).toBe(true);
    expect(chat.body.answer).toContain('5,000');
  });

  it('keeps the seeded doc in sync with real data instead of freezing it at first seed', async () => {
    const { token, workspace, demoContact } = await createOwnerContext();
    await fundWallet(String(workspace._id));

    const before = await request(app).get('/api/ai-suite/brain/packs/finance').set('Authorization', `Bearer ${token}`);
    expect(before.body.docs.find((d: { type: string }) => d.type === 'seeded').content).toContain('₹0');

    const product = await request(app).post('/api/ecom/products').set('Authorization', `Bearer ${token}`).send({ name: 'Pro Plan', salePrice: 7500 });
    await request(app)
      .post('/api/finance/subscriptions')
      .set('Authorization', `Bearer ${token}`)
      .send({ contactId: demoContact._id, productId: product.body.product._id, billingCycle: 'monthly', price: 7500 });

    const after = await request(app).get('/api/ai-suite/brain/packs/finance').set('Authorization', `Bearer ${token}`);
    const seededDocs = after.body.docs.filter((d: { type: string }) => d.type === 'seeded');
    expect(seededDocs).toHaveLength(1);
    expect(seededDocs[0].content).toContain('7,500');
  });

  it('logs an unanswered question when nothing seeded matches, and lets it be resolved', async () => {
    const { token, workspace } = await createOwnerContext();
    await fundWallet(String(workspace._id));

    const chat = await request(app)
      .post('/api/ai-suite/brain/packs/finance/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'xyzzy unrelated gibberish query about nothing on file' });
    expect(chat.body.grounded).toBe(false);

    const detail = await request(app).get('/api/ai-suite/brain/packs/finance').set('Authorization', `Bearer ${token}`);
    expect(detail.body.unanswered).toHaveLength(1);

    const resolve = await request(app).post(`/api/ai-suite/brain/unanswered/${detail.body.unanswered[0]._id}/resolve`).set('Authorization', `Bearer ${token}`);
    expect(resolve.body.question.resolved).toBe(true);
  });

  it('auto-seeds every pack in the catalog and lists doc counts', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ai-suite/brain/packs').set('Authorization', `Bearer ${token}`);
    expect(res.body.packs.length).toBeGreaterThanOrEqual(18);
    expect(res.body.packs.find((p: { key: string }) => p.key === 'finance')).toBeTruthy();
  });

  it('lets a user add manual knowledge (Memory/Documents/FAQs)', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app)
      .post('/api/ai-suite/brain/packs/finance/knowledge')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'faq', title: 'Refund policy', content: 'Refunds are processed within 5 business days.' });
    expect(res.status).toBe(201);
    expect(res.body.doc.type).toBe('faq');
  });
});

describe('AI Suite — AI Agents (Phase 7 core DoD)', () => {
  it('lists the 4 starter templates including the full Marketing Agent spec', async () => {
    const { token } = await createOwnerContext();
    const res = await request(app).get('/api/ai-suite/agent-templates').set('Authorization', `Bearer ${token}`);
    expect(res.body.templates).toHaveLength(4);
    const marketing = res.body.templates.find((t: { key: string }) => t.key === 'marketing');
    expect(marketing.guardrails).toEqual(
      expect.arrayContaining([expect.stringContaining('auto-publish'), expect.stringContaining('false'), expect.stringContaining('competitor')]),
    );
    expect(marketing.includedSkills).toEqual(['Generate Marketing Copy', 'Tag and Segment Lead']);
  });

  it('installs the Marketing Agent template and invokes it to draft copy', async () => {
    const { token, workspace } = await createOwnerContext();
    await fundWallet(String(workspace._id));

    const install = await request(app).post('/api/ai-suite/agents/install').set('Authorization', `Bearer ${token}`).send({ templateKey: 'marketing' });
    expect(install.status).toBe(201);
    expect(install.body.agent.name).toBe('Marketing Agent');
    const agentId = install.body.agent._id;

    const invoke = await request(app)
      .post(`/api/ai-suite/agents/${agentId}/invoke`)
      .set('Authorization', `Bearer ${token}`)
      .send({ input: 'Write a headline for our new pricing plan launch.' });
    expect(invoke.status).toBe(200);
    expect(invoke.body.reply).toContain('draft');

    const dashboard = await request(app).get('/api/ai-suite/dashboard').set('Authorization', `Bearer ${token}`);
    expect(dashboard.body.kpis.activeAgents).toBe(1);

    const messages = await request(app).get(`/api/ai-suite/agents/${agentId}/messages`).set('Authorization', `Bearer ${token}`);
    expect(messages.body.messages).toHaveLength(2);
  });
});

describe('AI Suite — BYOK provider connections', () => {
  it('connects and disconnects a provider, and BYOK calls skip the wallet debit', async () => {
    const { token, workspace } = await createOwnerContext();

    const connect = await request(app).post('/api/ai-suite/provider-connections/openai/connect').set('Authorization', `Bearer ${token}`).send({ apiKey: 'sk-test-1234' });
    expect(connect.status).toBe(200);
    expect(connect.body.connected).toBe(true);
    expect(connect.body.apiKeyMasked.endsWith('1234')).toBe(true);

    // No wallet funding needed — BYOK should not debit the workspace wallet.
    const contact = await request(app).post('/api/contacts').set('Authorization', `Bearer ${token}`).send({ name: 'BYOK Contact', email: 'byok@example.com' });
    const nba = await request(app).post(`/api/contacts/${contact.body.contact._id}/next-best-action`).set('Authorization', `Bearer ${token}`);
    expect(nba.status).toBe(200);

    const providers = await request(app).get('/api/ai-suite/provider-connections').set('Authorization', `Bearer ${token}`);
    expect(providers.body.providers.find((p: { provider: string }) => p.provider === 'openai').connected).toBe(true);

    const disconnect = await request(app).post('/api/ai-suite/provider-connections/openai/disconnect').set('Authorization', `Bearer ${token}`);
    expect(disconnect.body.connected).toBe(false);
    void workspace;
  });

  it('lists xai (Grok) as a connectable provider and can connect it', async () => {
    const { token } = await createOwnerContext();

    const providers = await request(app).get('/api/ai-suite/provider-connections').set('Authorization', `Bearer ${token}`);
    expect(providers.body.providers.find((p: { provider: string }) => p.provider === 'xai')).toBeTruthy();

    const connect = await request(app).post('/api/ai-suite/provider-connections/xai/connect').set('Authorization', `Bearer ${token}`).send({ apiKey: 'xai-test-key-1234' });
    expect(connect.status).toBe(200);
    expect(connect.body.connected).toBe(true);
    expect(connect.body.apiKeyMasked.endsWith('1234')).toBe(true);
  });
});
