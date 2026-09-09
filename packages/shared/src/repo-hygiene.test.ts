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
 * Both rules now take their inputs as parameters (`assessGitignoreAnchoring`,
 * `assessTrackedPackages`) and this file is **two** callers: the real repository,
 * and a synthetic input that drives each rule to a finding. Reading git and
 * reading `.gitignore` here is the wiring; the judgement is somewhere it can be
 * made to fail.
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
import {
  assessGraderFirewall,
  assessGitignoreAnchoring,
  assessScopeAgreement,
  assessToolingHostileSource,
  assessTrackedPackages,
  type PackageTracking,
} from './repo-hygiene.js';
import { REPO_SOURCE_EXPECTATION, walkFiles, workspacePackageDirs } from './scan-walker.js';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();

const git = (...args: string[]): string =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

/** `check-ignore -v` exits 1 when nothing matches, which is the passing case. */
const ignoredBy = (path: string): string => {
  try {
    return execFileSync('git', ['-C', REPO, 'check-ignore', '-v', path], { encoding: 'utf8' });
  } catch {
    // operational: git check-ignore exits 1 when nothing matches; that is the passing case
    return '';
  }
};

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

describe('the rules, driven by inputs that break them', () => {
  it('finds an unanchored pattern, and only that one', () => {
    const findings = assessGitignoreAnchoring(
      ['# a comment', '', '/dist', '**/node_modules', 'capture/', '!/capture/keep'].join('\n'),
    );
    expect(findings.map((f) => f.subject)).toEqual(['capture/']);
    expect(findings[0]?.message).toContain('matches at any depth by accident');
  });

  it('reads a negation on what follows the bang', () => {
    // `!capture/keep` is as unanchored as `capture/`: it un-ignores at any depth.
    expect(assessGitignoreAnchoring('!capture/keep').map((f) => f.subject)).toEqual([
      '!capture/keep',
    ]);
  });

  it('finds a package with no tracked files', () => {
    const entries: PackageTracking[] = [
      { package: 'packages/schema', trackedFiles: 40, manifestIgnoredBy: '' },
      { package: 'packages/capture', trackedFiles: 0, manifestIgnoredBy: '' },
    ];
    const findings = assessTrackedPackages(entries);
    expect(findings.map((f) => f.rule)).toEqual(['package-untracked']);
    expect(findings[0]?.subject).toBe('packages/capture');
  });

  it('finds a package whose manifest is ignored even when it has tracked files', () => {
    // The pair matters: a package can have tracked files from before the pattern
    // landed, so "has files" alone would report this one clean.
    const findings = assessTrackedPackages([
      { package: 'packages/capture', trackedFiles: 12, manifestIgnoredBy: '.gitignore:4:capture/' },
    ]);
    expect(findings.map((f) => f.rule)).toEqual(['package-ignored']);
  });

  it('finds a NUL byte, and says which line it is on', () => {
    const findings = assessToolingHostileSource('x.ts', Buffer.from('const a = 1;\nconst b = `x\0y`;\n'));
    expect(findings.map((f) => f.rule)).toEqual(['nul-byte']);
    expect(findings[0]?.subject).toBe('x.ts:2');
  });

  it('finds mixed line endings, which rot a committed patch silently', () => {
    const findings = assessToolingHostileSource('x.ts', Buffer.from('a\r\nb\nc\r\n'));
    expect(findings.map((f) => f.rule)).toEqual(['mixed-line-endings']);
  });

  it('says nothing about a file that is consistently CRLF', () => {
    // Consistent is not hostile: a patch generated against it applies. Only the
    // mixture defeats `git apply`.
    expect(assessToolingHostileSource('x.ts', Buffer.from('a\r\nb\r\n'))).toEqual([]);
  });

  it('finds a lone carriage return, which moves every reported line number', () => {
    const findings = assessToolingHostileSource('x.ts', Buffer.from('a\rb\nc\n'));
    expect(findings.map((f) => f.rule)).toEqual(['lone-cr']);
  });

  it('finds bytes that are not UTF-8', () => {
    const findings = assessToolingHostileSource('x.ts', Uint8Array.from([0x61, 0xff, 0xfe, 0x0a]));
    expect(findings.map((f) => f.rule)).toEqual(['not-utf8']);
  });

  it('reports every hostile property, not the first', () => {
    const findings = assessToolingHostileSource('x.ts', Buffer.from('a\0b\r\nc\nd\re\n'));
    expect(findings.map((f) => f.rule).sort()).toEqual(['lone-cr', 'mixed-line-endings', 'nul-byte']);
  });

  it('says nothing about a healthy repository', () => {
    expect(assessGitignoreAnchoring('/dist\n**/node_modules\n')).toEqual([]);
    expect(
      assessTrackedPackages([{ package: 'packages/cli', trackedFiles: 3, manifestIgnoredBy: '' }]),
    ).toEqual([]);
    expect(assessToolingHostileSource('x.ts', Buffer.from('const a = `x y`;\n'))).toEqual([]);
  });
});

describe.skipIf(!isRepo)('no source directory is hidden from git', () => {
  const packages = workspacePackages();

  it('finds the workspace packages at all', () => {
    // If this list were empty the assertions below would pass vacuously, which
    // is the failure mode every check in this repo has now been bitten by once.
    expect(packages.length).toBeGreaterThan(3);
    expect(packages).toContain('packages/capture');
  });

  it('every workspace package is tracked and its manifest is not ignored', () => {
    const entries: PackageTracking[] = packages.map((pkg) => ({
      package: pkg,
      trackedFiles: git('ls-files', '--', pkg).trim().split('\n').filter(Boolean).length,
      manifestIgnoredBy: ignoredBy(`${pkg}/package.json`),
    }));
    expect(assessTrackedPackages(entries).map((f) => f.message)).toEqual([]);
  });

  it('ignores every pattern deliberately: root-anchored, or explicitly **/', () => {
    const text = readFileSync(join(REPO, '.gitignore'), 'utf8');
    expect(text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length).toBeGreaterThan(0);
    expect(assessGitignoreAnchoring(text).map((f) => f.message)).toEqual([]);
  });

  it('no source file resists the tooling this repo runs on it', () => {
    // A NUL in a template literal in `grade.ts` compiled, tested and committed
    // without complaint, and made every future diff of that file unreadable.
    const { files, relative } = walkFiles({
      root: REPO,
      within: ['packages', 'scripts'],
      profile: 'source',
      expect: REPO_SOURCE_EXPECTATION,
    });
    const findings = files.flatMap((file, i) =>
      assessToolingHostileSource(relative[i]!, readFileSync(file)),
    );
    expect(findings.map((f) => f.message)).toEqual([]);
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

describe('the grader/infer firewall, in the half a machine can hold (0020)', () => {
  const infer = join(REPO, 'packages', 'infer');

  it('objects when infer imports the grader', () => {
    // Driven to fail against a synthetic subject: the real one passes, and a
    // rule that can only be run against input it passes on is a rule nobody can
    // prove fires. Note the deep specifier — the reach spelled around a
    // whole-name check is the one somebody would actually write.
    const findings = assessGraderFirewall({
      package: 'packages/infer',
      imports: ['@siteforge/schema', '@siteforge/verify/dist/grade/grade.js'],
      dependencies: ['@siteforge/schema'],
    });
    expect(findings.map((f) => f.rule)).toEqual(['firewall-import']);
    expect(findings[0]!.message).toContain('fitting to the metric');
  });

  it('objects to the dependency nothing imports yet', () => {
    const findings = assessGraderFirewall({
      package: 'packages/infer',
      imports: ['@siteforge/schema'],
      dependencies: ['@siteforge/schema', '@siteforge/verify'],
    });
    expect(findings.map((f) => f.rule)).toEqual(['firewall-dependency']);
  });

  it.skipIf(!isRepo)('holds against the real packages/infer', () => {
    const manifest = JSON.parse(readFileSync(join(infer, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const { files } = walkFiles({
      root: infer,
      within: ['src'],
      profile: 'source',
      // The package is a scaffold today, so the repo-wide floor does not apply
      // — but the walk still has to reach something, or this passes by walking
      // nothing on the day infer is fifty files.
      expect: { minFiles: 1, mustReach: ['src'] },
    });
    const imports = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/from '([^']+)';/g)].map((m) => m[1]!),
    );
    const findings = assessGraderFirewall({
      package: 'packages/infer',
      imports,
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
    });
    expect(findings.map((f) => f.message)).toEqual([]);
  });
});

describe('the two views of the repository agree, and neither defines scope alone', () => {
  /**
   * Third occurrence of one root (§13). A gate's *scope* comes from git's view
   * or from the filesystem's, and every time they have diverged here something
   * reported success over what it could not see — `packages/capture` missing
   * from git while local checks passed, the crawler missing from the walk while
   * the catch linter passed, `dist/` invisible to `git status --porcelain` while
   * a sabotaged build survived a revert.
   *
   * This file is two callers, as the rest of this suite is: the real repository,
   * and synthetic pairs that drive each direction to a finding.
   */
  const SOURCE_RE = /\.(?:ts|mts|cts|mjs|cjs|js)$/;

  /** Tracked source outside every scanner's scope, by prefix, with the reason. */
  const EXCUSED: Readonly<Record<string, string>> = {};

  const walkedSource = (): string[] => {
    const { files, relative } = walkFiles({
      root: REPO,
      within: ['packages', 'scripts'],
      profile: 'source',
      expect: REPO_SOURCE_EXPECTATION,
    });
    return files.map((_, i) => relative[i]!).filter((f) => SOURCE_RE.test(f));
  };

  const trackedSource = (): string[] =>
    git('ls-files')
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && SOURCE_RE.test(f))
      .filter((f) => f.startsWith('packages/') || f.startsWith('scripts/'));

  it('has no source file that only one of the two views can see', () => {
    // Measured at the commit that added this: 135 walked, 135 tracked, zero
    // divergence. Asserted as the set difference both ways rather than as equal
    // counts — a count is an aggregate, and this repo has been bitten by
    // aggregates hiding partial losses in both directions at once.
    const findings = assessScopeAgreement({
      walked: walkedSource(),
      tracked: trackedSource(),
      excused: EXCUSED,
    });
    expect(findings.map((f) => `${f.rule}: ${f.subject}`)).toEqual([]);
  });

  it('examined something, so a green tick is not an empty walk', () => {
    // The precondition, as the primary gate. Both sides empty produce zero
    // findings, which renders identically to agreement — the failure mode that
    // wears the answer's clothes.
    expect(walkedSource().length).toBeGreaterThan(100);
    expect(trackedSource().length).toBeGreaterThan(100);
  });

  it('objects to a scanned file no clone contains, with no exemption available', () => {
    // The `packages/capture` shape at file granularity: green here, absent in
    // verify:clean. Excusing it is deliberately impossible.
    const findings = assessScopeAgreement({
      walked: ['packages/capture/src/index.ts'],
      tracked: [],
      excused: { 'packages/capture': 'tempting, and not offered for this direction' },
    });
    expect(findings.map((f) => f.rule)).toEqual(['walked-but-untracked']);
    expect(findings[0]?.message).toContain('a fresh clone does not contain it');
  });

  it('objects to committed source no scanner reaches, unless it is excused', () => {
    // The walker's-ignore-list shape: committed code the linters skip in
    // silence. Excusable, because a real one exists — but it has to be said.
    const views = { walked: [], tracked: ['packages/x/src/a.ts'] };
    expect(assessScopeAgreement(views).map((f) => f.rule)).toEqual(['tracked-but-unwalked']);
    expect(
      assessScopeAgreement({ ...views, excused: { 'packages/x': 'generated, and not ours to lint' } }),
    ).toEqual([]);
  });

  it('excuses by path segment, never by string prefix', () => {
    // §13's identifier rule, fifth grammar and counting: `packages/schema/fixtures`
    // must not excuse `packages/schema/fixtures-real/`.
    const findings = assessScopeAgreement({
      walked: [],
      tracked: ['packages/schema/fixtures-real/live.ts'],
      excused: { 'packages/schema/fixtures': 'hand-built fixtures, not source' },
    });
    expect(findings.map((f) => f.rule)).toEqual(['tracked-but-unwalked']);
  });
});
