import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrateUp } from '@leaddesk/db';

/**
 * The real server process, not the Nest testing module: catches DI/decorator-metadata problems
 * that only appear when the app is actually started (e.g. a runner that drops emitDecoratorMetadata).
 */
let rs: MongoMemoryReplSet; let child: ChildProcess; let base: string; let logs = '';

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const url = rs.getUri('boot_test');
  const c = await MongoClient.connect(url); await migrateUp(c.db()); await c.close();
  const port = 39000 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${port}`;
  child = spawn('node', ['-r', '@swc-node/register', 'src/main.ts'], {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, MONGO_URL: url, PORT: String(port), JWT_ACCESS_SECRET: 'boot-secret-0123456789', LOCAL_KEK_BASE64: randomBytes(32).toString('base64'), NODE_ENV: 'test' },
  });
  child.stdout?.on('data', (d) => { logs += d; }); child.stderr?.on('data', (d) => { logs += d; });
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${base}/v1/me`); if (r.status === 401) return; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start:\n${logs}`);
}, 60_000);
afterAll(async () => { child?.kill('SIGTERM'); await rs?.stop(); });

it('the real server boots and serves a signup -> login -> authenticated call', async () => {
  const signup = await fetch(`${base}/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boot@x.io', password: 'correct-horse-9', name: 'B', tenantName: 'Boot Co' }) });
  expect(signup.status, logs).toBe(201);
  const { accessToken } = await signup.json() as any;
  expect(signup.headers.get('set-cookie')).toMatch(/ld_refresh=.*HttpOnly/i);
  const me = await fetch(`${base}/v1/me`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(me.status).toBe(200);
  const q = await fetch(`${base}/v1/do/queue`, { headers: { authorization: `Bearer ${accessToken}` } });
  expect(q.status).toBe(200);
  expect((await q.json() as any).caughtUp).toBe(true);
}, 30_000);
