/**
 * One file walker, for every scanner in the repo.
 *
 * Four scanners grew their own: the catch linter, the page-guard linter, the
 * secret gate, and the repo-hygiene audit. Three of them independently
 * reinvented "skip these directories" and one of them got it wrong in the way
 * this repo has now been bitten by three times — `IGNORED_DIRS` held the bare
 * name `capture`, so `packages/capture/` was skipped entirely and the linter
 * reported success over 8 of its 21 catch blocks. Detection twice is enough:
 * the rules live here, once.
 *
 * Two properties are built into the walk rather than left to each caller:
 *
 * 1. **Ignore patterns are anchored.** `/a/b` is exactly that path; `**​/x`
 *    matches basename `x` at any depth *because it says so*. An unanchored bare
 *    name is rejected at module load, so the bug that started this cannot be
 *    written here.
 * 2. **A scan declares what non-vacuous means, and the walker enforces it.**
 *    `expect` is required. A scanner whose glob silently matches nothing finds
 *    no violations and reports success — every scanner here has to say how many
 *    files it must see and which directories it must reach, and gets a thrown
 *    `VacuousScanError` rather than a green tick when it doesn't.
 *
 * The profile split is load-bearing. §3.4's gate must scan *every* file under
 * `capture/` — "not a chosen list: the point of the gate is that it does not
 * depend on somebody having thought of the artifact that leaked". So the `tree`
 * profile's ignore list is empty **by construction**, not by configuration:
 * there is no parameter through which a caller could give it one.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  PathPatternError, matchPath, matchesAnyPath, parsePathPattern, type PathPattern,
} from './identifiers.js';

/** Source extensions. A scanner that misses `.mjs` misses this repo's crawler. */
export const SOURCE_EXTENSIONS = ['.ts', '.mts', '.cts', '.mjs', '.cjs', '.js'] as const;

/**
 * Directories no source scan should descend into, anchored.
 *
 * `**​/dist` and `**​/node_modules` are any-depth *deliberately* — every package
 * has both. `/packages/schema/fixtures` is exact, because "fixtures" as a bare
 * name is the same latent bug as "capture" was: the day someone writes
 * `src/fixtures/*.ts` containing real code, a name match silently hides it.
 */
export const SOURCE_IGNORE = [
  '**/node_modules',
  '**/dist',
  '/.git',
  '/packages/schema/fixtures/**',
] as const;

/**
 * The `tree` profile ignores nothing. Not a default — the only possibility;
 * see `PATTERNS_BY_PROFILE` below, which has no third case to configure.
 */

export type ScanProfile = 'source' | 'tree';

/**
 * What a non-vacuous scan looks like. Required, never inferred.
 *
 * `mustReach` entries are root-relative directory prefixes. "Reached" means the
 * walk yielded at least one file under it — the check has to be about output,
 * because a directory that exists and is skipped still exists.
 */
export interface ScanExpectation {
  minFiles: number;
  mustReach: readonly string[];
}

/**
 * A scan that examined less than it promised to. A defect, never operational:
 * the scanner is misconfigured or the tree is not what the caller thinks, and
 * both must stop the run rather than pass quietly.
 */
export class VacuousScanError extends Error {
  override readonly name = 'VacuousScanError';
}

export interface ScanResult {
  /** Absolute paths, sorted. */
  files: readonly string[];
  /** The same files, root-relative with POSIX separators, sorted. */
  relative: readonly string[];
  root: string;
  profile: ScanProfile;
}

/**
 * Anchoring is checked here so an unanchored pattern cannot reach a walk.
 *
 * The parsing and the matching both live in `identifiers.ts` now — this module
 * had its own segment comparison, which is one more implementation of the
 * thing that keeps going wrong.
 */
export const assertAnchoredPatterns = (patterns: readonly string[]): PathPattern[] => {
  try {
    return patterns.map(parsePathPattern);
  } catch (err) {
    if (err instanceof PathPatternError) throw new VacuousScanError(err.message);
    throw err;
  }
};
const SOURCE_IGNORE_PATTERNS = assertAnchoredPatterns(SOURCE_IGNORE);

const PATTERNS_BY_PROFILE = {
  source: SOURCE_IGNORE_PATTERNS,
  tree: [] as PathPattern[],
} as const satisfies Record<ScanProfile, readonly PathPattern[]>;

const toPosix = (p: string): string => p.split(sep).join('/');

/**
 * Does this file list satisfy the expectation? Returns one message per shortfall.
 *
 * Separated from the walk so it takes its inputs as parameters: a gate reachable
 * only through the one input it passes on is a gate nobody can prove fires, and
 * the walk's input is a real directory tree. `walkFiles` is one caller; a list
 * of strings in a test is the other, and that one can be made to fail.
 *
 * All shortfalls, not the first: §13's rule that counts are disaggregated to the
 * granularity of the failure. "Never reached scripts/" and "never reached
 * packages/shared/src" are two different misconfigurations.
 */
export function assessScanCoverage(
  relativePaths: readonly string[],
  expect: ScanExpectation,
  describe: { root: string; profile: ScanProfile },
): string[] {
  const shortfalls: string[] = [];
  if (relativePaths.length < expect.minFiles) {
    shortfalls.push(
      `walked ${relativePaths.length} file(s) under ${describe.root}, expected at least ${expect.minFiles}. A scan that matches nothing reports success.`,
    );
  }
  for (const prefix of expect.mustReach) {
    const under = parsePathPattern(`/${prefix}/**`);
    if (!relativePaths.some((r) => matchPath(r, under))) {
      shortfalls.push(
        `the walk never reached ${prefix}/ — it is either missing, ignored, or filtered out by the ${describe.profile} profile.`,
      );
    }
  }
  return shortfalls;
}

/**
 * Every file under `root` (optionally restricted to `within`), by profile.
 *
 * Throws `VacuousScanError` unless the result satisfies `expect`.
 */
export function walkFiles(options: {
  root: string;
  /** Root-relative subdirectories to walk. Defaults to the whole root. */
  within?: readonly string[];
  profile: ScanProfile;
  expect: ScanExpectation;
}): ScanResult {
  const { root, profile, expect } = options;
  const ignore = PATTERNS_BY_PROFILE[profile];
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(root, abs));
      if (entry.isDirectory()) {
        if (!matchesAnyPath(rel, ignore)) walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (profile === 'source' && !SOURCE_EXTENSIONS.some((e) => entry.name.endsWith(e))) continue;
      found.push(abs);
    }
  };

  for (const sub of options.within ?? ['.']) {
    const abs = join(root, sub);
    // A missing root is a misconfiguration, not a scan result. The old walker
    // swallowed it, which meant a typo'd root produced an empty, green scan.
    if (!statSync(abs).isDirectory()) {
      throw new VacuousScanError(`${sub} is not a directory under ${root}`);
    }
    walk(abs);
  }

  found.sort();
  const rel = found.map((f) => toPosix(relative(root, f)));

  const shortfalls = assessScanCoverage(rel, expect, { root, profile });
  if (shortfalls.length > 0) throw new VacuousScanError(shortfalls.join('\n'));

  return { files: found, relative: rel, root, profile };
}

/**
 * The repo-wide source scan every linter runs.
 *
 * The `mustReach` list is the point: `packages/capture/scripts` is named here
 * because that is the directory a bare-name ignore hid, and `scripts` because a
 * linter that never reads itself is a linter nobody checks.
 */
export const REPO_SOURCE_EXPECTATION: ScanExpectation = {
  minFiles: 20,
  mustReach: ['packages/capture/scripts', 'packages/shared/src', 'packages/schema/src', 'scripts'],
};

/**
 * A capture tree's shape is known; its size is not, and does not need to be —
 * `coverage.json` is what asserts a capture holds enough. This expectation only
 * has to rule out scanning an empty or wrong directory and calling it clean.
 */
export const CAPTURE_TREE_EXPECTATION: ScanExpectation = {
  minFiles: 1,
  mustReach: ['routes', 'network'],
};

/** Workspace package directories, from `pnpm-workspace.yaml`'s own globs. */
export function workspacePackageDirs(repo: string, yaml: string): string[] {
  const globs = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)]
    .map((m) => m[1]!.trim())
    .filter((g) => g.includes('/*'));
  const dirs: string[] = [];
  for (const glob of globs) {
    const base = glob.replace(/\/\*+$/, '');
    let entries;
    try {
      entries = readdirSync(join(repo, base), { withFileTypes: true });
    } catch {
      // operational: a workspace glob may name a directory that does not exist
      // yet (`envs/` before the first clone). An absent base contributes none.
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        statSync(join(repo, base, entry.name, 'package.json'));
      } catch {
        // operational: a directory without a package.json is not a package.
        continue;
      }
      dirs.push(`${base}/${entry.name}`);
    }
  }
  return dirs.sort();
}
