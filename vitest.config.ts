import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['apps/api/src/services/**/*.ts', 'apps/api/src/security/**/*.ts'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      thresholds: { perFile: true, lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
