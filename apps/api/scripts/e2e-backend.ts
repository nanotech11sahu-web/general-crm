/**
 * Boots a real backend for browser tests: in-memory MongoDB replica set + the real API process
 * (same start command as production), seeded with a workspace, an agent and two routed leads.
 * Prints one line `READY {json}` when done. Never use outside tests.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createServer } from 'node:http';
import { migrateUp, runWithTenant, TenantDbRouter } from '@leaddesk/db';

const PORT = Number(process.env.E2E_API_PORT ?? 3300);
const base = `http://127.0.0.1:${PORT}`;

async function j(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const r = await fetch(base + path, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
  const text = await r.text(); const body = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${r.status} ${text}`);
  return body;
}

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('e2e');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  const api = spawn('node', ['-r', '@swc-node/register', 'src/main.ts'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, MONGO_URL: url, PORT: String(PORT), JWT_ACCESS_SECRET: 'e2e-secret', LOCAL_KEK_BASE64: randomBytes(32).toString('base64'), REALTIME_POLL_MS: '200', NODE_ENV: 'test' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const shutdown = async () => { api.kill('SIGTERM'); await rs.stop().catch(() => undefined); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${base}/v1/me`)).status === 401) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

  const owner = await j('/v1/auth/signup', { method: 'POST', body: { email: 'owner@e2e.test', password: 'owner-pass-12345', name: 'Olivia Owner', tenantName: 'E2E Realty', industryPreset: 'real_estate' } });
  const inv = await j('/v1/invitations', { method: 'POST', token: owner.accessToken, body: { email: 'agent@e2e.test', role: 'agent' } });
  const agent = await j(`/v1/invitations/${inv.inviteToken}/accept`, { method: 'POST', body: { name: 'Asha Agent', password: 'agent-pass-12345' } });
  const me = await j('/v1/me', { token: agent.accessToken });
  await j('/v1/me/presence', { method: 'PUT', token: agent.accessToken, body: { state: 'online' } });
  await j('/v1/rules/assignment', { method: 'PUT', token: owner.accessToken, body: { rules: [{ name: 'Everything to Asha', action: { kind: 'specific_user', userId: me.userId } }] } });
  await j('/v1/sla', { method: 'PUT', token: owner.accessToken, body: { policies: [{ name: 'Default', claimSeconds: 600, firstContactSeconds: 3600 }] } });
  for (const [name, phone, city] of [['Anita Desai', '9812345670', 'Pune'], ['Rahul Mehta', '9812345671', 'Mumbai']]) {
    await j('/v1/leads', { method: 'POST', token: owner.accessToken, body: { name, city, contacts: [{ value: phone }] } });
  }

  // Test-only seeding endpoint (browser tests cannot reach the real SMS/WhatsApp providers, so an inbound reply is planted directly).
  const router = new TenantDbRouter(url); const db = await router.connect();
  createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/inbound-reply') { res.statusCode = 404; res.end(); return; }
    (async () => {
      const lead = await j('/v1/leads', { method: 'POST', token: owner.accessToken, body: { name: 'Reply Rani', city: 'Nashik', contacts: [{ value: '9812345699' }] } });
      await runWithTenant(owner.tenantId, async () => {
        const conn: any = await db.repos.connections.create({ provider: 'sms-msg91', category: 'sms', name: 'E2E SMS', publicId: 'e2e-sms-pub', status: 'verified' });
        const conv: any = await db.repos.conversations.create({ leadId: lead.leadId, channel: 'sms', connectionId: conn._id, externalThreadId: '+919812345699', lastInboundAt: new Date(), lastMessageAt: new Date(), lastMessagePreview: 'Can you call me after 6?', unreadCount: 1 });
        await db.repos.messages.create({ conversationId: conv._id, leadId: lead.leadId, direction: 'in', channel: 'sms', body: 'Can you call me after 6?', providerMessageId: 'e2e-in-1', source: 'inbound', status: 'received' });
        await db.repos.leads.updateOne({ _id: lead.leadId }, { $set: { firstContactedAt: new Date(), lastContactedAt: new Date() } });
      });
      res.end('{"ok":true}');
    })().catch((e) => { res.statusCode = 500; res.end(String(e)); });
  }).listen(PORT + 1, '127.0.0.1');
  console.log('READY ' + JSON.stringify({ api: base, agentId: me.userId }));
}
main().catch((e) => { console.error(e); process.exit(1); });
