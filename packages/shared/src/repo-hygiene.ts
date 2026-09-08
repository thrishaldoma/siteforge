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
  readonly rule: 'unanchored-pattern' | 'package-untracked' | 'package-ignored';
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
