/**
 * The identifier rule, and the reason it is narrow.
 *
 * A rule that fired on every `.includes()` would collect sixty exemptions, and
 * every exemption is a place someone stopped thinking. It fires on the
 * receivers an audit actually found, and array membership — `['GET'].includes`,
 * `argv.includes('--flag')` — is a different thing and stays unflagged.
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
const lint = async (): Promise<any> =>
  import(join(REPO, 'scripts', 'lint-identifiers.mjs') as string);

describe('string operations on identifier grammars are linted', () => {
  it('passes on the repository as it stands', () => {
    const out = execFileSync('node', [join(REPO, 'scripts', 'lint-identifiers.mjs')], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toContain('every identifier comparison is structured');
  });

  it('examined a non-zero number of comparisons', async () => {
    // Every one of them is currently exempt with a reason, so a rule that
    // stopped matching would also print a green tick. The count is what
    // distinguishes the two.
    const { lintRepo } = await lint();
    const { examined } = lintRepo(REPO);
    expect(examined).toBeGreaterThan(4);
  });

  it.each([
    ['a URL prefix test', "if (href.startsWith(ORIGIN)) return;"],
    ['a path suffix test', "if (rel.endsWith('auth/storage-state.json')) return;"],
    ['a selector substring test', "const ok = selector.includes('.btn');"],
    ['a mime substring test', "const css = mime.includes('css');"],
    ['a route id substring test', "if (routeId.includes('--anon--')) return;"],
  ])('flags %s', async (_label, src) => {
    const { lintIdentifiers } = await lint();
    expect(lintIdentifiers('x.mjs', src).violations).toHaveLength(1);
  });

  it.each([
    ['array membership', "if (['GET', 'HEAD'].includes(method)) return;"],
    ['argv membership', "const flag = process.argv.includes('--allow-destructive');"],
    ['a parsed comparison', "if (sameOrigin(href, ORIGIN)) return;"],
    ['an unrelated receiver', "if (name.includes('delete')) return;"],
    ['a justified case', "// identifier: paths — this is the pattern parser itself.\nif (pattern.startsWith('/')) return;"],
  ])('does not flag %s', async (_label, src) => {
    const { lintIdentifiers } = await lint();
    expect(lintIdentifiers('x.mjs', src).violations).toEqual([]);
  });

  it('accepts a multi-line reason, and rejects a marker-less comment', async () => {
    const { lintIdentifiers } = await lint();
    const justified = '// identifier: paths — the parser reads its own\n// anchoring markers here.\nif (pattern.startsWith("/")) return;';
    expect(lintIdentifiers('x.mjs', justified).violations).toEqual([]);
    const unmarked = '// this is fine, honestly\nif (pattern.startsWith("/")) return;';
    expect(lintIdentifiers('x.mjs', unmarked).violations).toHaveLength(1);
  });

  it('ignores matches inside strings and comments', async () => {
    const { lintIdentifiers } = await lint();
    const src = 'const msg = "url.includes(x) is banned";\n// mime.includes(y) too\n';
    expect(lintIdentifiers('x.mjs', src)).toEqual({ examined: 0, violations: [] });
  });
});
