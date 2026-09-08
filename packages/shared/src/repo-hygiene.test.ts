/**
 * Structural checks on the repository itself.
 *
 * These live here because `shared` is the cross-cutting package and there is no
 * better home; what they check is the repo, not this library.
 *
 * The motivating bug: `.gitignore` contained an unanchored `capture/`, which
 * matches a directory of that name at any depth — so `packages/capture/` was
 * ignored in its entirety. Two commits named `capture:` contained no capture
 * code, `pnpm rung2` and `pnpm rung3` ran against files that existed only in one
 * working tree, and nothing anywhere said so.
 *
 * The assertion that catches it is deliberately the *unenumerated* one: every
 * workspace package must have tracked files. A hand-listed set of paths to check
 * only catches paths somebody thought to list, and not thinking of one is the
 * entire failure mode.
 *
 * The slow reproduction gate (`pnpm verify:clean`) covers the same ground from a
 * real clone, but it takes minutes and runs browsers. This runs in the ordinary
 * suite, which is where a check has to be if it is going to fire before a commit
 * rather than after one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { workspacePackageDirs } from './scan-walker.js';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

/**
 * Directories the workspace globs actually resolve to.
 *
 * From `@siteforge/shared`'s walker module, not a fourth private copy — this
 * test's own `readdirSync` loop was one of the implementations the scanner
 * walker consolidated.
 */
const workspacePackages = (): string[] =>
  workspacePackageDirs(REPO, readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'));

const isRepo = existsSync(join(REPO, '.git'));

describe.skipIf(!isRepo)('no source directory is hidden from git', () => {
  const packages = workspacePackages();

  it('finds the workspace packages at all', () => {
    // If this list were empty the assertions below would pass vacuously, which
    // is the failure mode every check in this repo has now been bitten by once.
    expect(packages.length).toBeGreaterThan(3);
    expect(packages).toContain('packages/capture');
  });

  it.each(workspacePackages())('%s has tracked files', (pkg) => {
    const tracked = git('ls-files', '--', pkg).trim();
    expect(
      tracked.length,
      `${pkg} is a workspace package with no tracked files — it is almost certainly matched by a .gitignore pattern`,
    ).toBeGreaterThan(0);
  });

  it.each(workspacePackages())('%s/package.json is not ignored', (pkg) => {
    // check-ignore exits 1 when nothing matches, which is the passing case.
    let matched = '';
    try {
      matched = execFileSync('git', ['-C', REPO, 'check-ignore', '-v', `${pkg}/package.json`], {
        encoding: 'utf8',
      });
    } catch {
      // operational: git check-ignore exits 1 when nothing matches; that is the passing case
      matched = '';
    }
    expect(matched, `${pkg}/package.json is ignored by ${matched.trim()}`).toBe('');
  });

  it('ignores every pattern deliberately: root-anchored, or explicitly **/', () => {
    const lines = readFileSync(join(REPO, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const pattern = line.startsWith('!') ? line.slice(1) : line;
      expect(
        // identifier: paths — .gitignore's own anchoring syntax, which is what this
        // assertion is about; there is no parsed form of a pattern's leading marker.
        pattern.startsWith('/') || pattern.startsWith('**/'),
        `"${line}" is unanchored: it matches at any depth by accident. Use /x for root-only or **/x to say you meant any depth.`,
      ).toBe(true);
    }
  });

  it('still ignores the artifact directories it is there to ignore', () => {
    // The anchoring must not have loosened anything. `capture/` at the root is
    // sensitive (§3.4) and build output is noise.
    for (const path of [
      'capture/site/network/session.har',
      'packages/schema/dist/index.js',
      'packages/capture/node_modules/x',
      'envs/demo/app/page.tsx',
    ]) {
      let ignored = true;
      try {
        execFileSync('git', ['-C', REPO, 'check-ignore', '-q', path]);
      } catch {
        // operational: git check-ignore exits 1 to mean "not ignored", not a failure to run
        ignored = false;
      }
      expect(ignored, `${path} should still be ignored`).toBe(true);
    }
  });
});
