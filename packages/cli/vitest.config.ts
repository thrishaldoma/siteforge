import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Scaffolded packages have no tests yet; `pnpm -r test` must not fail on them.
    passWithNoTests: true,
  },
});
