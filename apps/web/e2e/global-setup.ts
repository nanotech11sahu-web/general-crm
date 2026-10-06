import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

declare global { var __backend: ChildProcess | undefined }

/** Starts the real API (+ in-memory Mongo) via apps/api/scripts/e2e-backend.ts and waits for READY. */
export default async function setup() {
  const apiDir = resolve(__dirname, '../../api');
  const child = spawn('node', ['-r', '@swc-node/register', 'scripts/e2e-backend.ts'], { cwd: apiDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'inherit'] });
  globalThis.__backend = child;
  await new Promise<void>((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('backend did not become ready in 90s')), 90_000);
    child.stdout!.on('data', (d) => { buf += d; process.stdout.write(d); if (/READY \{/.test(buf)) { clearTimeout(t); ok(); } });
    child.on('exit', (code) => { clearTimeout(t); fail(new Error(`backend exited early (${code})`)); });
  });
  process.env.E2E_TEARDOWN_PID = String(child.pid);
}
