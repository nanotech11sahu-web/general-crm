#!/usr/bin/env node
/**
 * Compiles every workspace package and service from TypeScript to plain CommonJS next to its source (`dist/`), with the decorator
 * metadata NestJS needs. Production then runs `node -r ./scripts/use-dist.cjs apps/api/dist/main.js`: no TypeScript toolchain at
 * runtime, faster start-up, lower memory. Development and tests keep running the TS source directly.
 */
const fs = require('node:fs'); const path = require('node:path');
const swc = require('@swc/core');
const root = path.resolve(__dirname, '..');
const dirs = ['apps/api', 'apps/worker', 'apps/webhook-ingress', 'packages/db', 'packages/crypto', 'packages/shared', 'packages/domain', 'packages/platform', ...fs.readdirSync(path.join(root, 'packages/connectors')).map((d) => `packages/connectors/${d}`)].filter((d) => fs.existsSync(path.join(root, d, 'src')));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
let n = 0;
for (const d of dirs) {
  const src = path.join(root, d, 'src'); const out = path.join(root, d, 'dist'); fs.rmSync(out, { recursive: true, force: true });
  for (const f of walk(src)) {
    const rel = path.relative(src, f); const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!f.endsWith('.ts') || f.endsWith('.d.ts')) { if (!f.endsWith('.d.ts')) fs.copyFileSync(f, dest); continue; }
    const r = swc.transformSync(fs.readFileSync(f, 'utf8'), { filename: f, sourceMaps: false, module: { type: 'commonjs' }, jsc: { target: 'es2022', keepClassNames: true, parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } });
    fs.writeFileSync(dest.replace(/\.ts$/, '.js'), r.code); n++;
  }
}
console.log(`compiled ${n} files in ${dirs.length} projects`);
