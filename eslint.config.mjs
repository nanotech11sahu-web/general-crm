import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/test-results/**', '**/next-env.d.ts', 'apps/web/public/**', 'load/**', 'scripts/*.cjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Feature code must never touch raw Mongoose models (spec §6.2).
    files: ['apps/**/src/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'mongoose', message: 'Use TenantScopedRepository from @leaddesk/db; raw Mongoose is forbidden in apps.' }],
        patterns: [{ group: ['@nestjs/mongoose'], message: 'Use repositories from @leaddesk/db.' }],
      }],
    },
  },
);
