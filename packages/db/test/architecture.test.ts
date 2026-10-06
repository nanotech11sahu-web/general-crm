import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});

it('feature code (apps/*/src) never imports mongoose or @nestjs/mongoose (spec §6.2)', () => {
  const root = join(__dirname, '../../../apps');
  const offenders = readdirSync(root).flatMap((app) => walk(join(root, app, 'src')))
    .filter((f) => /from ['"](mongoose|@nestjs\/mongoose)['"]|require\(['"]mongoose['"]\)|import\(['"]mongoose['"]\)/.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
