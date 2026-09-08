/**
 * The walker's own invariants, each with the bug it exists to catch.
 *
 * Two of these are not hypothetical. `hides a directory matched by bare name`
 * is the bug that hid `packages/capture/` from the catch linter — the third
 * time an unanchored name match cost this repo a whole package. `the tree
 * profile ignores nothing` guards §3.4: the secret gate must scan every file
 * written under `capture/`, and a shared ignore list reaching it would quietly
 * weaken the strongest gate in the repo during a refactor whose entire purpose
 * was to remove vacuous checks.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assessScanCoverage,
  CAPTURE_TREE_EXPECTATION,
  REPO_SOURCE_EXPECTATION,
  SOURCE_IGNORE,
  VacuousScanError,
  assertAnchoredPatterns,
  walkFiles,
  workspacePackageDirs,
} from './scan-walker.js';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A tree holding source in the places a scanner must reach and must not. */
const makeTree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-walk-'));
  roots.push(root);
  for (const dir of ['src', 'src/node_modules', 'dist', 'routes/r0', 'network']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'b.mjs'), 'export const b = 2;\n');
  writeFileSync(join(root, 'src', 'node_modules', 'vendor.js'), 'module.exports = 3;\n');
  writeFileSync(join(root, 'dist', 'a.js'), 'export const a = 1;\n');
  writeFileSync(join(root, 'routes', 'r0', 'dom.json'), '{}');
  writeFileSync(join(root, 'network', 'session.har'), '{}');
  return root;
};

const NOTHING_EXPECTED = { minFiles: 0, mustReach: [] };

describe('one walker, and the anti-vacuity lives in it', () => {
  it('finds source and skips vendored and built output', () => {
    const { relative } = walkFiles({
      root: makeTree(), profile: 'source', expect: NOTHING_EXPECTED,
    });
    expect(relative).toEqual(['src/a.ts', 'src/b.mjs']);
  });

  it('the tree profile ignores nothing — §3.4 scans what it was not told about', () => {
    const { relative } = walkFiles({
      root: makeTree(), profile: 'tree', expect: CAPTURE_TREE_EXPECTATION,
    });
    // Every file, including the ones the source profile drops and the ones with
    // no source extension at all.
    expect(relative).toEqual([
      'dist/a.js', 'network/session.har', 'routes/r0/dom.json',
      'src/a.ts', 'src/b.mjs', 'src/node_modules/vendor.js',
    ]);
  });

  it('has no parameter through which the tree profile could be given a skip list', () => {
    // The profile is the whole configuration surface. If this ever compiles with
    // an `ignore` option, the guarantee above is gone.
    const root = makeTree();
    const call = walkFiles as unknown as (o: Record<string, unknown>) => { relative: string[] };
    const configured = call({
      root, profile: 'tree', expect: CAPTURE_TREE_EXPECTATION,
      ignore: ['**/node_modules'],
    });
    // The whole list, not "node_modules survived". An absence check would pass
    // an `ignore` that dropped something *else*; this cannot — the configured
    // walk has to be indistinguishable from the unconfigured one.
    const plain = walkFiles({ root, profile: 'tree', expect: CAPTURE_TREE_EXPECTATION });
    expect(configured.relative).toEqual(plain.relative);
    expect(plain.relative.some((f) => f.startsWith('src/node_modules/'))).toBe(true);
  });

  describe('sabotage: a scan that examined nothing must not report success', () => {
    it('throws when it walked fewer files than promised', () => {
      expect(() => walkFiles({
        root: makeTree(), profile: 'source', expect: { minFiles: 99, mustReach: [] },
      })).toThrow(VacuousScanError);
    });

    it('throws when it never reached a directory it claims to cover', () => {
      expect(() => walkFiles({
        root: makeTree(), profile: 'source', expect: { minFiles: 0, mustReach: ['routes'] },
      })).toThrow(/never reached routes/);
    });

    it('throws on a root that does not exist, rather than returning empty', () => {
      expect(() => walkFiles({
        root: makeTree(), within: ['typo'], profile: 'source', expect: NOTHING_EXPECTED,
      })).toThrow();
    });

    it('rejects an unanchored ignore pattern — the bug that hid packages/capture', () => {
      expect(() => assertAnchoredPatterns(['capture'])).toThrow(VacuousScanError);
      expect(() => assertAnchoredPatterns(['**/capture', '/capture'])).not.toThrow();
    });
  });

  describe('the expectation, as a rule over a file list', () => {
    // The three tests above drive it through a real directory tree, which is one
    // caller and the slow one. The rule itself takes a list of paths, so it can
    // be shown to object to each shortfall separately — and to report *both*
    // when both are wrong, which the walk's throw-on-first could never show.
    const AT = { root: '/repo', profile: 'source' as const };

    it('says nothing when the list satisfies the expectation', () => {
      expect(assessScanCoverage(['a/x.ts', 'b/y.ts'], { minFiles: 2, mustReach: ['a', 'b'] }, AT)).toEqual([]);
    });

    it('names a directory the walk never reached', () => {
      const out = assessScanCoverage(['a/x.ts'], { minFiles: 1, mustReach: ['a', 'scripts'] }, AT);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain('never reached scripts/');
    });

    it('is not satisfied by a prefix match — packages/capture is not packages/capture-lib', () => {
      // The bug family this whole module exists for: `startsWith` would call
      // this reached. The pattern is parsed and compared by segment.
      expect(
        assessScanCoverage(['packages/capture-lib/x.ts'], { minFiles: 1, mustReach: ['packages/capture'] }, AT),
      ).toHaveLength(1);
    });

    it('reports the file floor and every unreached directory together', () => {
      const out = assessScanCoverage([], { minFiles: 20, mustReach: ['scripts', 'packages'] }, AT);
      expect(out).toHaveLength(3);
    });
  });

  it('every shipped ignore pattern is anchored', () => {
    expect(() => assertAnchoredPatterns(SOURCE_IGNORE)).not.toThrow();
  });

  describe('against this repository', () => {
    it('reaches every directory the linters claim to cover', () => {
      const { files } = walkFiles({
        root: REPO, within: ['packages', 'scripts'], profile: 'source',
        expect: REPO_SOURCE_EXPECTATION,
      });
      expect(files.length).toBeGreaterThan(20);
    });

    it('reaches every workspace package that has source in it', () => {
      // The generalisation of the capture bug: any package the source walk
      // cannot see is a package every linter silently skips.
      const { relative } = walkFiles({
        root: REPO, within: ['packages'], profile: 'source',
        expect: { minFiles: 20, mustReach: [] },
      });
      const packages = workspacePackageDirs(
        REPO, readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'),
      );
      expect(packages.length).toBeGreaterThan(3);
      const withSource = packages.filter((p) =>
        existsSync(join(REPO, p, 'src')) || existsSync(join(REPO, p, 'scripts')));
      for (const pkg of withSource) {
        const prefix = `${pkg}/`;
        expect(relative.some((r) => r.startsWith(prefix)), `${pkg} is invisible to every linter`)
          .toBe(true);
      }
    });
  });
});
