/**
 * Structural rules about the repository, as functions of their inputs.
 *
 * Both of these lived inline in `repo-hygiene.test.ts`, where the only input
 * they could ever see was this repository — a working one. A rule that can only
 * be run against the input it passes on is a rule nobody can prove fires, which
 * is the root shared by the vacuous invariant, the unreachable sabotage and the
 * never-exercised allow-branch. Here the text and the git facts arrive as
 * parameters; the test supplies the real ones and a synthetic broken pair.
 *
 * The bug both rules exist for: `.gitignore` contained an unanchored `capture/`,
 * which matches a directory of that name at any depth — so `packages/capture/`
 * was ignored in its entirety, two commits named `capture:` contained no capture
 * code, and every local check passed.
 */

/** One thing wrong, phrased as the sentence the operator has to act on. */
export interface HygieneFinding {
  readonly rule:
    | 'unanchored-pattern'
    | 'package-untracked'
    | 'package-ignored'
    | 'walked-but-untracked'
    | 'tracked-but-unwalked'
    | FirewallRule
    | ToolingHostileRule;
  readonly subject: string;
  readonly message: string;
}

/**
 * Every `.gitignore` pattern is anchored on purpose: `/x` for root-only, `**​/x`
 * where any depth is intended.
 *
 * Takes the file's text rather than a path, so a pattern nobody has committed
 * can be tested. Blank lines and comments are not patterns; a negation keeps its
 * `!` for the message and is judged on what follows it.
 */
export function assessGitignoreAnchoring(text: string): HygieneFinding[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const findings: HygieneFinding[] = [];
  for (const line of lines) {
    const pattern = line.startsWith('!') ? line.slice(1) : line;
    // identifier: paths — .gitignore's own anchoring syntax is the subject of
    // this rule, and a pattern's leading marker has no parsed form. There is
    // nothing here to compare by segment: the question is which character the
    // pattern begins with.
    if (pattern.startsWith('/') || pattern.startsWith('**/')) continue;
    findings.push({
      rule: 'unanchored-pattern',
      subject: line,
      message: `"${line}" is unanchored: it matches at any depth by accident. Use /x for root-only or **/x to say you meant any depth.`,
    });
  }
  return findings;
}

/** What git says about one workspace package. */
export interface PackageTracking {
  readonly package: string;
  /** How many files `git ls-files` reports under it. */
  readonly trackedFiles: number;
  /** The `check-ignore -v` line for its `package.json`, or `''` when none matches. */
  readonly manifestIgnoredBy: string;
}

/**
 * Every workspace package has tracked files, and its manifest is not ignored.
 *
 * Deliberately the *unenumerated* assertion: a hand-listed set of paths only
 * catches paths somebody thought to list, and not thinking of one is the entire
 * failure mode. The caller supplies the package list from the workspace globs,
 * so a package added tomorrow is covered the day it lands.
 */
export function assessTrackedPackages(entries: readonly PackageTracking[]): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  for (const entry of entries) {
    if (entry.trackedFiles === 0) {
      findings.push({
        rule: 'package-untracked',
        subject: entry.package,
        message: `${entry.package} is a workspace package with no tracked files — it is almost certainly matched by a .gitignore pattern`,
      });
    }
    if (entry.manifestIgnoredBy !== '') {
      findings.push({
        rule: 'package-ignored',
        subject: entry.package,
        message: `${entry.package}/package.json is ignored by ${entry.manifestIgnoredBy.trim()}`,
      });
    }
  }
  return findings;
}

/**
 * Source that resists the practice's own tooling.
 *
 * **The fourth vacuity mode.** Alongside never-fires, fires-on-everything and
 * unreachable-state, there is: *the sabotage cannot be written.* A gate whose
 * subject file cannot be diffed or patched is one nobody can prove fires, for a
 * reason one step earlier than the other three — the machinery for proving it
 * does not exist rather than failing to discriminate.
 *
 * Found the day it happened: a stray NUL inside a template literal in
 * `grade.ts`. It compiled, typechecked, tested and committed without a murmur.
 * `git diff` then printed "Binary files differ", and `git diff > sabotage/x.patch`
 * produced a patch with no hunks. Nothing else in the repo would ever have said
 * so.
 *
 * The rules are the ways a text file stops behaving like one, each with the
 * specific tool it breaks — not a taste checklist:
 *
 *   `nul-byte`             git calls the file binary: no diff, no patch.
 *   `not-utf8`             the same, plus every scanner here decodes as UTF-8.
 *   `mixed-line-endings`   a hunk generated against one convention will not
 *                          apply against the other, so a committed patch rots
 *                          silently the next time an editor rewrites the file.
 *   `lone-cr`              every tool here counts lines by `\n`, so a bare CR
 *                          makes reported line numbers point somewhere else.
 *
 * Considered and rejected: a missing final newline. It degrades a diff (a
 * one-line append becomes a two-line hunk) but never prevents one, and the mode
 * is prevention. A rule with no motivating instance and no tool it breaks is
 * padding, and padding is what makes the next reader stop believing the list.
 */
export type ToolingHostileRule = 'nul-byte' | 'not-utf8' | 'mixed-line-endings' | 'lone-cr';

const lineAt = (bytes: Uint8Array, index: number): number => {
  let line = 1;
  for (let i = 0; i < index && i < bytes.length; i += 1) if (bytes[i] === 0x0a) line += 1;
  return line;
};

/**
 * Every way this file resists being diffed, patched or scanned.
 *
 * Takes the bytes, so a file nobody has committed can be tested — and the
 * repo-wide caller is one of two, which is the rule this session established.
 */
export function assessToolingHostileSource(file: string, bytes: Uint8Array): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  const at = (rule: ToolingHostileRule, index: number, why: string): void => {
    findings.push({
      rule,
      subject: `${file}:${lineAt(bytes, index)}`,
      message: `${file}:${lineAt(bytes, index)} — ${why} No sabotage patch can be written against a file the tooling cannot read.`,
    });
  };

  const nul = bytes.indexOf(0);
  if (nul !== -1) {
    at('nul-byte', nul, 'a NUL byte, so git treats this file as binary: its diffs print "Binary files differ" and a generated patch carries no hunks.');
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // operational: an invalid byte sequence is the finding, not a failure to run
    findings.push({
      rule: 'not-utf8',
      subject: file,
      message: `${file} is not valid UTF-8, so git may treat it as binary and every scanner here decodes it wrongly. No sabotage patch can be written against a file the tooling cannot read.`,
    });
  }

  let crlf = 0;
  let bareLf = 0;
  let loneCr = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0x0d) {
      if (bytes[i + 1] === 0x0a) crlf += 1;
      else if (loneCr === -1) loneCr = i;
    } else if (bytes[i] === 0x0a && bytes[i - 1] !== 0x0d) {
      bareLf += 1;
    }
  }
  if (crlf > 0 && bareLf > 0) {
    at('mixed-line-endings', 0, `${crlf} CRLF and ${bareLf} LF line endings in one file: a hunk generated against either convention fails to apply against the other.`);
  }
  if (loneCr !== -1) {
    at('lone-cr', loneCr, 'a carriage return with no newline after it; every scanner here counts lines by \n, so reported line numbers point at the wrong place.');
  }

  return findings;
}

/**
 * The grader/infer firewall (decision 0020), in the half a machine can hold.
 *
 * 0015 §0 ordered the steps so infer is written against a score and never
 * against a metric's definition: a category whose definition shapes an
 * inference strategy is fitting to the metric, and the number it then produces
 * says nothing. The instruction is procedural — *do not read the grader's
 * source while writing infer* — and no check can enforce reading.
 *
 * What a check can enforce is the mechanical half: `packages/infer` never
 * imports `@siteforge/verify` and never declares it a dependency. That closes
 * the path by which a category's definition reaches infer as *code* — a
 * threshold read off the contract, a denominator recomputed, a matcher reused.
 * It does not close the path through a person's memory, and 0020 says so
 * plainly rather than letting a green here be read as the whole firewall.
 */
export type FirewallRule = 'firewall-import' | 'firewall-dependency';

/** What the guarded package imports and declares. Facts, gathered by the caller. */
export interface FirewallSubject {
  readonly package: string;
  /** Every module specifier its sources import. */
  readonly imports: readonly string[];
  /** Every name in its package.json dependency maps. */
  readonly dependencies: readonly string[];
}

export function assessGraderFirewall(
  subject: FirewallSubject,
  forbidden = '@siteforge/verify',
): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  // A prefix test, not equality: `@siteforge/verify/dist/grade/grade.js` is the
  // same reach into the grader's source, spelled around a whole-name check.
  const reaches = (name: string): boolean => name === forbidden || name.startsWith(`${forbidden}/`);
  for (const specifier of subject.imports.filter(reaches)) {
    findings.push({
      rule: 'firewall-import',
      subject: specifier,
      message: `${subject.package} imports ${specifier}. The grader's definitions must not reach infer as code — a threshold read off the contract, or a denominator recomputed from it, is fitting to the metric, which is the failure 0015 §0 ordered the steps to prevent. The score is the only channel.`,
    });
  }
  for (const dependency of subject.dependencies.filter(reaches)) {
    findings.push({
      rule: 'firewall-dependency',
      subject: dependency,
      message: `${subject.package} declares ${dependency} as a dependency. Nothing imports it today, which is what makes this the edge nobody would notice going live.`,
    });
  }
  return findings;
}

/**
 * The two views of what the repository contains, reconciled.
 *
 * **Third occurrence of one root, and this is the generalisation.** Every gate
 * has a *scope*, and a scope comes from one of two views — git's or the
 * filesystem's — which are not the same set. Each time they have diverged here,
 * a gate reported success over something it could not see:
 *
 *   - an unanchored `.gitignore` pattern hid `packages/capture`, so git's view
 *     lacked a whole source package while every local check ran against the
 *     filesystem and passed. `verify:clean` closed that by running from a clone,
 *     and `assessTrackedPackages` closed it at *package* granularity;
 *   - the walker's own `IGNORED_DIRS` held the bare name `capture`, so the
 *     filesystem view lacked the crawler and the catch linter reported success
 *     over 8 of its 21 catch blocks;
 *   - `dist/` is gitignored, so `git status --porcelain` structurally could not
 *     see a sabotaged build surviving a revert, and a score was read off it.
 *     `assessBuildResidue` closed that one by hashing the files git cannot see.
 *
 * The first two are the *same* failure in opposite directions, and neither was
 * visible from inside the view that had the gap. So this is the reconciliation
 * at **file** granularity, asserted as a set difference both ways rather than
 * as "the counts match" — a count is an aggregate and this repo has been bitten
 * by aggregates hiding partial losses. Both sides arrive as parameters.
 *
 * `walkedButUntracked` has **no exemptions**: a source file no clone contains
 * is one `verify:clean` never compiles, never lints and never tests, however
 * green it looks here. `trackedButUnwalked` has declared ones, because a
 * committed file legitimately outside every scanner's scope exists — but it has
 * to be *said*, for the reason `NOT_FROZEN` entries are said: a file nobody
 * scanned and nobody excused reads as "someone decided" when it means "nobody
 * looked".
 *
 * Measured at the commit that added this: 135 walked, 135 tracked, zero
 * divergence in either direction.
 */
export interface ScopeViews {
  /** Repo-relative source paths the filesystem walker reached. */
  readonly walked: readonly string[];
  /** Repo-relative source paths `git ls-files` reports. */
  readonly tracked: readonly string[];
  /**
   * Tracked paths deliberately outside every scanner's scope, each with its
   * reason. A prefix match, so a directory can be excused once.
   */
  readonly excused?: Readonly<Record<string, string>>;
}

export function assessScopeAgreement(views: ScopeViews): HygieneFinding[] {
  const walked = new Set(views.walked);
  const tracked = new Set(views.tracked);
  const excused = views.excused ?? {};
  const findings: HygieneFinding[] = [];

  for (const file of [...walked].sort()) {
    if (tracked.has(file)) continue;
    findings.push({
      rule: 'walked-but-untracked',
      subject: file,
      message: `${file} is scanned by this repo's gates but is not tracked by git, so a fresh clone does not contain it. Every gate over it is green here and absent in verify:clean — the shape that hid packages/capture for eight commits. There is no exemption for this direction: commit it, or stop scanning it.`,
    });
  }
  for (const file of [...tracked].sort()) {
    if (walked.has(file)) continue;
    // Prefix by path segment, never by string: `/packages/schema/fixtures` must
    // not excuse `/packages/schema/fixtures-real/x.ts`.
    const reason = Object.entries(excused).find(([prefix]) =>
      file === prefix || file.startsWith(`${prefix}/`),
    );
    if (reason !== undefined) continue;
    findings.push({
      rule: 'tracked-but-unwalked',
      subject: file,
      message: `${file} is committed source that no scanner reaches, so the catch linter, the identifier linter and the empty-admits linter all skip it in silence — the shape that hid packages/capture's 21 catch blocks from the linter that was meant to read them. Either widen the walk, or excuse it by prefix with the reason it is outside scope.`,
    });
  }
  return findings;
}
