/**
 * The linter that enforces the catch taxonomy, tested like any other check.
 *
 * Including the assertion that it examined a non-zero number of catches. A
 * scanner whose glob silently misses a file extension finds nothing and reports
 * success — the vacuous-check failure this repo has now hit three times, most
 * recently in this very file's subject: `lint-catch.mjs` skipped
 * `packages/capture/` entirely because its ignore list matched the directory
 * *name* `capture`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lint = async (): Promise<any> => import(join(REPO, 'scripts', 'lint-catch.mjs') as string);

describe('the catch taxonomy is linted, not remembered', () => {
  it('passes on the repository as it stands', () => {
    const out = execFileSync('node', [join(REPO, 'scripts', 'lint-catch.mjs')], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toContain('every catch distinguishes');
  });

  it('examined a non-zero number of catches', async () => {
    // That the *walk* reached packages/capture/scripts is no longer asserted
    // here: it is REPO_SOURCE_EXPECTATION, enforced inside walkFiles and
    // sabotage-tested in scan-walker.test.ts. This assertion is the part that
    // is specific to this linter — files can be found and still not parsed.
    const { lintRepo } = await lint();
    const { examined } = lintRepo(REPO);
    expect(examined).toBeGreaterThan(10);
  });

  it.each([
    ['a bare catch', 'try { f(); } catch { g(); }'],
    ['a bound catch that swallows', 'try { f(); } catch (err) { log(err); }'],
    ['an empty catch', 'try { f(); } catch (e) {}'],
  ])('flags %s', async (_label, src) => {
    const { lintCatches } = await lint();
    expect(lintCatches('x.mjs', src).violations).toHaveLength(1);
  });

  it.each([
    ['a rethrow', 'try { f(); } catch (err) { rethrowIfDefect(err); g(); }'],
    ['an explicit throw', 'try { f(); } catch (err) { throw err; }'],
    ['a justified swallow', 'try { f(); } catch {\n  // operational: no body on a 204\n}'],
    ['a justified one-liner', '// operational: not parseable\ntry { f(); } catch { return null; }'],
  ])('accepts %s', async (_label, src) => {
    const { lintCatches } = await lint();
    expect(lintCatches('x.mjs', src).violations).toEqual([]);
  });

  // `.catch(fn)` is the same swallow in different syntax. Nine of them sat in
  // the crawler while the linter reported every catch accounted for — including
  // one in the anonymous auth probe, where a swallowed rejection left the
  // endpoint `unknown` and §8 resolves `unknown` to not-required for reads.
  it.each([
    ['an empty promise catch', 'await p().catch(() => {});'],
    ['a promise catch that logs', 'await p().catch((e) => log(e));'],
    ['a promise catch returning a default', 'const x = await p().catch(() => null);'],
  ])('flags %s', async (_label, src) => {
    const { lintCatches } = await lint();
    expect(lintCatches('x.mjs', src).violations).toHaveLength(1);
  });

  it.each([
    ['a justified promise catch', '// operational: the page is already gone\nawait p().catch(() => {});'],
    ['a promise catch that rethrows', 'await p().catch((e) => { rethrowIfDefect(e); });'],
    ['a promise catch passed a handler', 'await p().catch(rethrowIfDefect);'],
  ])('accepts %s', async (_label, src) => {
    const { lintCatches } = await lint();
    expect(lintCatches('x.mjs', src).violations).toEqual([]);
  });

  it('counts promise handlers as examined, so the rule cannot go vacuous', async () => {
    const { lintCatches } = await lint();
    expect(lintCatches('x.mjs', 'await p().catch(() => {});').examined).toBe(1);
  });

  it('does not report the word catch inside a string or a comment', async () => {
    const { lintCatches } = await lint();
    const src = 'const msg = "bare catch { } is banned";\n// catch { } in a comment\n';
    expect(lintCatches('x.mjs', src)).toEqual({ examined: 0, violations: [] });
  });
});
