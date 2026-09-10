/**
 * A sabotage as a **semantic edit** rather than a context-anchored patch.
 *
 * `git apply` matches surrounding lines. Two patches rotted in a single turn
 * because ordinary product commits moved those lines while leaving the
 * expression they target untouched — `driver-does-not-parse` (a comment grew
 * above the call) and `infer-reads-the-grader` (an import joined the block).
 * Neither defect changed; only the neighbourhood did. That tax compounds with
 * the patch count, and the count only goes up.
 *
 * So an edit is `{file, find, replace}` where `find` is **the expression
 * itself**, carrying only as much surrounding text as uniqueness requires. A
 * comment landing above it, an import beside it, or a hundred lines moving
 * are all invisible to it.
 *
 * ### Two hard failures, and the second is the interesting one
 *
 * - **`find` absent** — the code it targets is gone. Same verdict a rotted
 *   patch gets, and it should be: a sabotage that cannot run is a gate nobody
 *   is checking. The difference is that it now means *the target changed*
 *   rather than *the neighbourhood changed*.
 * - **`find` present more than once** — ambiguous, and it **fails** rather
 *   than editing the first match. Which occurrence gets sabotaged would
 *   otherwise be a property of scan order, and a sabotage that silently moves
 *   to a different call site is a gate testing something nobody declared.
 *   This is the within-rung determinism rule (0042) applied to the harness
 *   that checks the rules.
 *
 * The reverse direction is checked with the same strictness: after applying,
 * `replace` must occur exactly once, or the edit cannot be undone
 * unambiguously and the harness must not try.
 */

export interface SemanticEdit {
  /** Repo-relative path. */
  readonly file: string;
  /**
   * The expression to replace. Must occur exactly once.
   *
   * `null` means **create this file**, whose whole content is `replace`. One
   * sabotage needs it — `grader-module-added-without-a-pin` drops a
   * `thresholds.ts` into the frozen grade directory, and the hole it proves is
   * a *new* module beside the pinned ones. Modelled explicitly rather than as
   * an edit against an empty string, because "the file was absent" and "the
   * expression was absent" are different failures and the second is a rot.
   */
  readonly find: string | null;
  /** What it becomes. Must occur exactly once after applying. */
  readonly replace: string;
}

export interface EditFinding {
  readonly file: string;
  readonly problem:
    | 'absent'
    | 'ambiguous'
    | 'replacement-absent'
    | 'replacement-ambiguous'
    | 'no-op'
    | 'already-present';
  readonly detail: string;
}

const occurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
};

/**
 * Whether an edit can be applied to this text, and unapplied afterwards.
 *
 * Takes the text as a parameter so a test can drive every verdict without a
 * filesystem — §13's rule that a gate's judgement is separable from its wiring.
 */
export function assessSemanticEdit(edit: SemanticEdit, text: string | null): EditFinding | null {
  if (edit.find === null) {
    // A creation. The only thing that can be wrong is that the file is
    // already there — then the sabotage is not adding a module, it is
    // overwriting one, which is a different defect than the one declared.
    return text === null
      ? null
      : {
          file: edit.file,
          problem: 'already-present',
          detail: `${edit.file} already exists, so creating it would overwrite rather than add — not the defect this declares`,
        };
  }
  if (text === null) {
    return {
      file: edit.file,
      problem: 'absent',
      detail: `${edit.file} does not exist, so there is nothing to edit`,
    };
  }
  if (edit.find === edit.replace) {
    return {
      file: edit.file,
      problem: 'no-op',
      detail: 'find and replace are identical, so this edit changes nothing and the gate it claims to break would pass for the wrong reason',
    };
  }
  const found = occurrences(text, edit.find);
  if (found === 0) {
    return {
      file: edit.file,
      problem: 'absent',
      detail: `the expression it targets is not in ${edit.file} any more. Re-anchor it: unlike a context-anchored patch, this means the code itself changed, not its neighbourhood.`,
    };
  }
  if (found > 1) {
    return {
      file: edit.file,
      problem: 'ambiguous',
      detail: `the expression occurs ${found} times in ${edit.file}. Editing the first would make scan order decide which call site is sabotaged; widen \`find\` until it names one.`,
    };
  }
  // The undo has to be as unambiguous as the do. An edit whose result already
  // appears elsewhere cannot be reverted by the same rule that applied it.
  const after = text.replace(edit.find, edit.replace);
  const back = occurrences(after, edit.replace);
  if (back === 0) {
    return {
      file: edit.file,
      problem: 'replacement-absent',
      detail: 'applying the edit did not produce its own replacement text, so it cannot be reversed',
    };
  }
  if (back > 1) {
    return {
      file: edit.file,
      problem: 'replacement-ambiguous',
      detail: `after applying, the replacement occurs ${back} times, so the revert would not know which to undo`,
    };
  }
  return null;
}

/**
 * Apply. Throws unless `assessSemanticEdit` returned `null` for this text.
 *
 * Returns `null` for the file's new content only in the delete direction,
 * which is how a creation is undone.
 */
export function applySemanticEdit(edit: SemanticEdit, text: string | null): string {
  const finding = assessSemanticEdit(edit, text);
  if (finding !== null) throw new Error(`${finding.problem}: ${finding.detail}`);
  if (edit.find === null) return edit.replace;
  return (text as string).replace(edit.find, edit.replace);
}

/** Undo. The same rule in reverse, so a partial revert is impossible. */
export function revertSemanticEdit(edit: SemanticEdit, text: string): string | null {
  // A creation is undone by deleting the file, and the caller is told so with
  // `null` rather than being handed an empty file — an empty `thresholds.ts`
  // sitting in the frozen directory is residue, and the residue check would
  // rightly fail on it.
  if (edit.find === null) return null;
  return applySemanticEdit({ file: edit.file, find: edit.replace, replace: edit.find }, text);
}
