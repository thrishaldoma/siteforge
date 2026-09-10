/**
 * Every `.mjs` the repository ships actually parses.
 *
 * A syntax error in `capture-site.mjs` survived `pnpm build`, `pnpm typecheck`,
 * `pnpm lint` and `pnpm test` — all four green — and was found only by running
 * a nine-minute crawl that died on the first line of `node`.
 *
 * Nothing in the suite was wrong. `tsc` does not read `.mjs`; the lint scripts
 * read these files as **text**, and so does `determinism.test.mjs`, which is the
 * one test that looks at this driver at all. `verify:clean` runs rung 2 and rung
 * 3, neither of which imports `capture-site.mjs`, because the real driver needs
 * Docker and a live target. So the union of every gate covered this file's
 * *contents* and never its *syntax*.
 *
 * That is §13's chokepoint rule pointed at the test suite itself: the reach was
 * "files some gate imports", the claim was "the code is checked". `node --check`
 * closes it for a few milliseconds per file, and it is the cheapest possible
 * version of the thing every other gate here assumes.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkFiles } from './scan-walker.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('every shipped .mjs parses', () => {
  const { files } = walkFiles({
    root: REPO,
    within: ['packages', 'scripts'],
    profile: 'source',
    // The floor is asserted by `walkFiles` itself rather than after the fact:
    // a walk that reached nothing must not report a clean parse of nothing.
    expect: { minFiles: 100, mustReach: ['packages/capture/scripts/capture-site.mjs'] },
  });
  const mjs = files.filter((f) => f.endsWith('.mjs'));

  it('finds the drivers at all, so a passing run means something', () => {
    // "Reached nothing" and "reached everything and found nothing" render
    // identically without a floor. `walkFiles`' own `mustReach` covers the
    // driver this test was written for; this covers the population.
    expect(mjs.length).toBeGreaterThan(8);
  });

  it.each(mjs)('%s', (file) => {
    // `node --check` is a parse, not an execution: no import is resolved and no
    // top-level code runs, so this stays a syntax check on a file that needs
    // Docker to do anything else.
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
  });
});
