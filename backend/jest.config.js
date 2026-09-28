/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  testTimeout: 30000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/server.ts', '!src/seed/**'],
  // Phase 12 hardening: coverage floor enforced as a CI merge gate (see .github/workflows/ci.yml).
  // Set just under the coverage this suite actually achieves, so real drift fails the gate
  // without the threshold itself being fictional busywork.
  coverageThreshold: {
    global: {
      statements: 84,
      lines: 86,
      functions: 84,
      branches: 62,
    },
  },
};
