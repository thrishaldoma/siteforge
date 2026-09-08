import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'capture',
    // `.test.mjs` too: the origin guard is exercised against a real browser and
    // the code under test is a `.mjs` script, so the test lives beside it.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    testTimeout: 60_000,
    environment: 'node',
    // Scaffolded packages have no tests yet; `pnpm -r test` must not fail on them.
    passWithNoTests: true,
  },
});
