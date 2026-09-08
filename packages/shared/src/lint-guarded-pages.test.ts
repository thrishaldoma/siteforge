/**
 * The page-level escape guard, enforced rather than audited.
 *
 * The sabotage case that matters is the last one: it takes the real
 * `rung3.mjs`, deletes a guard line, and asserts the linter fails. A synthetic
 * string proves the regex works; mutating the actual file proves the linter
 * would have caught the regression in the file it exists to protect.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lint = async (): Promise<any> =>
  import(join(REPO, 'scripts', 'lint-guarded-pages.mjs') as string);

const RUNG3 = join(REPO, 'packages', 'capture', 'scripts', 'rung3.mjs');

describe('every page the crawler opens carries the escape guards', () => {
  it('passes on the repository as it stands', () => {
    const out = execFileSync('node', [join(REPO, 'scripts', 'lint-guarded-pages.mjs')], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toContain('every page opened carries the escape guards');
  });

  it('actually examined pages — a linter that finds nothing also passes', async () => {
    const { lintRepo } = await lint();
    const { examined, files } = lintRepo(REPO);
    expect(files).toBeGreaterThan(20);
    // rung 3 opens four; the spike and the origin-guard test one each.
    expect(examined).toBeGreaterThanOrEqual(6);
  });

  it.each([
    ['an unguarded page', 'const page = await ctx.newPage();\nawait page.goto(url);'],
    ['an unbound page', 'await ctx.newPage();'],
    [
      'a guard naming a different page',
      'const page = await ctx.newPage();\ninstallEscapeGuards(other, { onBlocked });',
    ],
    [
      'a guard attached too late',
      `const page = await ctx.newPage();\n${'x();\n'.repeat(90)}installEscapeGuards(page, { onBlocked });`,
    ],
  ])('flags %s', async (_label, src) => {
    const { lintGuardedPages } = await lint();
    expect(lintGuardedPages('x.mjs', src).violations).toHaveLength(1);
  });

  it.each([
    ['a guarded page', 'const page = await ctx.newPage();\ninstallEscapeGuards(page, { onBlocked });'],
    [
      'a guard after a comment and a blank line',
      'const page = await ctx.newPage();\n\n// §6: fresh page per probe.\ninstallEscapeGuards(page, { onBlocked });',
    ],
    [
      'a justified exception',
      '// unguarded: asserts what an unguarded page does\nconst page = await ctx.newPage();',
    ],
  ])('accepts %s', async (_label, src) => {
    const { lintGuardedPages } = await lint();
    expect(lintGuardedPages('x.mjs', src).violations).toEqual([]);
  });

  it('does not see a newPage inside a string or a comment', async () => {
    const { lintGuardedPages } = await lint();
    const src = 'const s = "await ctx.newPage()";\n// await ctx.newPage()\n';
    expect(lintGuardedPages('x.mjs', src)).toEqual({ examined: 0, violations: [] });
  });

  // Sabotage: reintroduce the bug in the real file and prove the gate fails.
  it('fails when a guard is deleted from rung3.mjs itself', async () => {
    const { lintGuardedPages } = await lint();
    const original = readFileSync(RUNG3, 'utf8');
    expect(lintGuardedPages('rung3.mjs', original).violations).toEqual([]);

    const guard = '  installEscapeGuards(page, { onBlocked });\n';
    expect(original.includes(guard)).toBe(true);
    const sabotaged = original.replace(guard, '');

    const { violations } = lintGuardedPages('rung3.mjs', sabotaged);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('escape unrecorded');
  });
});
