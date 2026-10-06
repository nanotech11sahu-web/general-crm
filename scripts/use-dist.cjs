/**
 * Preload for the compiled build: workspace packages declare `main: src/index.ts` (so dev and tests need no build step);
 * this maps each `@leaddesk/*` import to the compiled `dist/index.js` instead.
 */
const Module = require('node:module'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const map = new Map();
for (const base of ['packages', 'packages/connectors']) {
  for (const d of fs.readdirSync(path.join(root, base))) {
    const pj = path.join(root, base, d, 'package.json');
    if (fs.existsSync(pj)) { const p = JSON.parse(fs.readFileSync(pj, 'utf8')); if (p.name && fs.existsSync(path.join(root, base, d, 'dist/index.js'))) map.set(p.name, path.join(root, base, d, 'dist/index.js')); }
  }
}
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return map.has(request) ? map.get(request) : orig.call(this, request, ...rest); };
