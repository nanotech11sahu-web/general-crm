#!/usr/bin/env node
/**
 * Smoke test for the compiled build (run after scripts/build-dist.cjs): migrates a throw-away MongoDB with the compiled migration CLI,
 * boots the compiled API and webhook ingress, checks their health endpoints and a signup round trip, and loads every compiled worker module.
 */
const { spawn } = require('node:child_process');
/** Async on purpose: the in-process memory MongoDB needs this process's event loop to keep its replica set healthy. */
const run = (args, opts) => new Promise((resolve) => { const c = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }); let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d)); c.on('exit', (code) => resolve({ status: code, out })); }); const path = require('node:path'); const fs = require('node:fs'); const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..'); const hook = path.join(__dirname, 'use-dist.cjs');
const { MongoMemoryReplSet } = require(require.resolve('mongodb-memory-server', { paths: [path.join(root, 'apps/api')] }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label, ms = 60_000) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await sleep(300); } }
(async () => {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); const url = rs.getUri('smoke');
  const env = { ...process.env, MONGO_URL: url, JWT_ACCESS_SECRET: 'smoke-secret-0123456789', LOCAL_KEK_BASE64: randomBytes(32).toString('base64'), NODE_ENV: 'test' };
  const kids = []; let ok = false;
  try {
    const mig = await run(['-r', hook, 'dist/migrate-cli.js', 'up'], { cwd: path.join(root, 'packages/db'), env });
    if (mig.status !== 0) throw new Error(`migrate failed: ${mig.out}`); console.log('migrate ok');
    const start = (dir, port) => { const c = spawn('node', ['-r', hook, 'dist/main.js'], { cwd: path.join(root, dir), env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'inherit'] }); kids.push(c); return c; };
    start('apps/api', 3790); start('apps/webhook-ingress', 3791);
    await until(async () => (await fetch('http://127.0.0.1:3790/healthz')).ok, 'api /healthz'); console.log('api ok');
    await until(async () => (await fetch('http://127.0.0.1:3791/healthz')).ok, 'ingress /healthz'); console.log('ingress ok');
    const r = await fetch('http://127.0.0.1:3790/v1/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'smoke@x.io', password: 'correct-horse-9', name: 'Smoke', tenantName: 'Smoke Co' }) });
    if (r.status !== 201) throw new Error(`signup answered ${r.status}`); const me = await fetch('http://127.0.0.1:3790/v1/me', { headers: { authorization: `Bearer ${(await r.json()).accessToken}` } });
    if (!me.ok) throw new Error('signed-in call failed'); console.log('signup round trip ok');
    const wdist = path.join(root, 'apps/worker/dist'); let n = 0;
    for (const f of fs.readdirSync(wdist)) if (f.endsWith('.js') && f !== 'main.js') { const r = await run(['-r', hook, '-e', `require(${JSON.stringify(path.join(wdist, f))})`], { env }); if (r.status !== 0) throw new Error(`worker module ${f} does not load: ${r.out.slice(0, 300)}`); n++; }
    console.log(`worker modules load (${n})`); ok = true;
  } finally { for (const k of kids) k.kill('SIGTERM'); await rs.stop().catch(() => undefined); }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e.message); process.exit(1); });
