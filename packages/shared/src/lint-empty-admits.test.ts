/**
 * The empty-admits linter, tested the way it asks its subjects to be tested.
 *
 * Including the count: a scanner that walked no files finds no violations and
 * prints a tick, which is the same output as a clean repository. That is the
 * precondition rule, and this file's subject is the rule one level down —
 * a predicate handed nothing says yes.
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
const lint = async (): Promise<any> => import(join(REPO, 'scripts', 'lint-empty-admits.mjs') as string);

describe('an empty container must never silently admit', () => {
  it('passes on the repository as it stands, having examined something', () => {
    const out = execFileSync('node', [join(REPO, 'scripts', 'lint-empty-admits.mjs')], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toContain('fails closed, throws, or says what it means');
    const examined = Number(/lint:empty — (\d+) every/.exec(out)?.[1] ?? 0);
    // A walk that reached nothing would print the same tick as a clean repo.
    expect(examined).toBeGreaterThan(5);
  });

  it('catches the shape that made inUniverse universal', async () => {
    const { lintEmptyAdmits } = await lint();
    const source = [
      'export function inUniverse(path, basePath) {',
      '  const base = segments(basePath);',
      '  const actual = segments(path);',
      '  return base.every((segment, i) => actual[i] === segment);',
      '}',
    ].join('\n');
    const { violations } = lintEmptyAdmits('match.ts', source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(4);
    expect(violations[0].message).toContain('true is the permissive answer');
  });

  it('accepts a length guard within reach of the call', async () => {
    const { lintEmptyAdmits } = await lint();
    const guarded = 'if (want.length === 0) return false;\nreturn want.every((s, i) => got[i] === s);';
    expect(lintEmptyAdmits('a.ts', guarded).violations).toEqual([]);
  });

  it('accepts an explicit statement of what empty means', async () => {
    const { lintEmptyAdmits } = await lint();
    const excused = '// empty: the caller guarantees at least one row\nreturn rows.every((r) => r.ok);';
    expect(lintEmptyAdmits('a.ts', excused).violations).toEqual([]);
  });

  it('does not accept a guard on a different collection', async () => {
    const { lintEmptyAdmits } = await lint();
    // The near-miss that makes a name-blind rule useless: the author guarded
    // the collection they were thinking about, not the one they iterated.
    const wrong = 'if (other.length === 0) return false;\nreturn rows.every((r) => r.ok);';
    expect(lintEmptyAdmits('a.ts', wrong).violations).toHaveLength(1);
  });

  it('reads code, not comments and strings', async () => {
    const { lintEmptyAdmits } = await lint();
    const prose = '/** rows.every(x) is true on empty. */\nconst s = "rows.every(y)";';
    expect(lintEmptyAdmits('a.ts', prose).violations).toEqual([]);
  });
});
