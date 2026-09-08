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
  '/packages/schema/fixtures',
] as const;

/** The `tree` profile ignores nothing. Not a default — the only possibility. */
const TREE_IGNORE = [] as const;

const IGNORE_BY_PROFILE = {
  source: SOURCE_IGNORE,
  tree: TREE_IGNORE,
} as const satisfies Record<ScanProfile, readonly string[]>;

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

/** Anchoring is checked here so an unanchored pattern cannot reach a walk. */
export const assertAnchoredPatterns = (patterns: readonly string[]): void => {
  for (const p of patterns) {
    if (!p.startsWith('/') && !p.startsWith('**/')) {
      throw new VacuousScanError(
        `ignore pattern ${JSON.stringify(p)} is unanchored. Use '/path' for an exact path or '**/name' for any depth — a bare name is how packages/capture/ was hidden from the linter.`,
      );
    }
  }
};
assertAnchoredPatterns(SOURCE_IGNORE);

const isIgnored = (relDir: string, patterns: readonly string[]): boolean =>
  patterns.some((p) => {
    if (p.startsWith('**/')) {
      const name = p.slice(3);
      return relDir === name || relDir.endsWith(`/${name}`);
    }
    const exact = p.slice(1);
    return relDir === exact || relDir.startsWith(`${exact}/`);
  });

const toPosix = (p: string): string => p.split(sep).join('/');

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
  const ignore = IGNORE_BY_PROFILE[profile];
  const found: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = toPosix(relative(root, abs));
      if (entry.isDirectory()) {
        if (!isIgnored(rel, ignore)) walk(abs);
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

  if (found.length < expect.minFiles) {
    throw new VacuousScanError(
      `walked ${found.length} file(s) under ${root}, expected at least ${expect.minFiles}. A scan that matches nothing reports success.`,
    );
  }
  for (const prefix of expect.mustReach) {
    if (!rel.some((r) => r === prefix || r.startsWith(`${prefix}/`))) {
      throw new VacuousScanError(
        `the walk never reached ${prefix}/ — it is either missing, ignored, or filtered out by the ${profile} profile.`,
      );
    }
  }

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
