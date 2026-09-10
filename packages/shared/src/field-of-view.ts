/**
 * What each gate can see, and — the part that keeps being the defect — what it
 * cannot.
 *
 * Five instances of one failure, which is why this stopped being a rule and
 * became a standing audit:
 *
 *   1. an unanchored `.gitignore` pattern hid `packages/capture` from **git**,
 *      so a whole source package had never been committed while every
 *      filesystem check passed;
 *   2. the walker's own ignore list held the bare name `capture`, so the
 *      **filesystem** view lacked the crawler and the catch linter reported
 *      success over 8 of its 21 catch blocks;
 *   3. `dist/` is gitignored, so `git status --porcelain` structurally could not
 *      see a sabotaged build survive a revert, and two wrong scores were read
 *      off it;
 *   4. `guardContext` attaches *after* `newContext`, so it could never enforce a
 *      construction argument — four of six contexts ran without
 *      `prefers-reduced-motion` while every manifest asserted it;
 *   5. no gate ever *parsed* a `.mjs`, so a dropped paren in `capture-site.mjs`
 *      passed build, typecheck, lint and test, and was found by a nine-minute
 *      crawl dying on the first line of `node`.
 *
 * In every one the gate behaved correctly and its **claim was broader than its
 * coverage**. That gap is invisible from inside the gate, and it is invisible
 * from outside too, because a gate that cannot see a region reports exactly what
 * it reports when the region is clean.
 *
 * ## The scope of this audit
 *
 * Not every gate has a field of view. `assessGitignoreAnchoring(text)` is handed
 * one string; `assessDivergenceBudget(entries, n, denominators)` is handed its
 * entries. **A gate whose subject is its parameter has no selection to get
 * wrong**, and declaring a blind region for it would be padding — which §13
 * warns is what makes the next reader stop believing the list.
 *
 * So this covers the gates that **select their own subject**: they walk a tree,
 * read a directory, or scan a moment in time, and something decides what lands
 * in front of them.
 *
 * ## Why most blind regions need no sabotage
 *
 * A blind region is only a *hole* when nothing else covers it. `scripts-parse`
 * cannot see a TypeScript syntax error — and `tsc` can, so that region is
 * `coveredBy` a sibling and needs a pointer, not a patch. A region with
 * `coveredBy: null` is a region **nobody** covers, and that one has to be proved
 * uncovered: `provenBy` names a control in `scripts/sabotage.mjs` that puts a
 * defect there and asserts the gate stays green.
 *
 * That reuses the harness's existing control kind rather than inventing a
 * second mechanism, and it generalises §13's rule that every mutation table
 * carries a perturbation which must *not* move the thing it names.
 */

export interface BlindRegion {
  /** What the gate cannot see. Specific enough to write a patch against. */
  readonly region: string;
  /** Why it cannot — the property of the selection, not an excuse. */
  readonly why: string;
  /**
   * The gate that does cover it, or `null` when nothing does.
   *
   * `null` is not a failure. It is a hole someone has decided to live with, and
   * `provenBy` is what stops it being a hole nobody has checked is still there.
   */
  readonly coveredBy: string | null;
  /**
   * A control in `scripts/sabotage.mjs` that breaks something in this region and
   * asserts the gate **stays green**. Required exactly when `coveredBy` is null.
   */
  readonly provenBy?: string | undefined;
}

export interface FieldOfView {
  /** The gate, named as it is in the code. */
  readonly gate: string;
  /** How it chooses its subject. The sentence that turns out to be the claim. */
  readonly covers: string;
  readonly blindTo: readonly BlindRegion[];
}

export interface FieldOfViewReport {
  /** Gates in the inventory with no declaration. */
  readonly undeclared: readonly string[];
  /** Declarations for gates that no longer exist. */
  readonly stale: readonly string[];
  /** `coveredBy: null` with no control proving the region is uncovered. */
  readonly unproven: readonly string[];
  /** `provenBy` naming a sabotage entry that is not in the table. */
  readonly danglingProof: readonly string[];
  /** `provenBy` given alongside a `coveredBy` — one or the other, not both. */
  readonly proofWithoutHole: readonly string[];
  /** `coveredBy` naming a gate that is not itself declared here. */
  readonly danglingCover: readonly string[];
}

/**
 * Reconcile the declarations against the gates that exist and the controls that
 * exist. Both directions, per `assessScopeAgreement`'s argument: a count nets an
 * addition against a removal.
 */
export function assessFieldOfView(input: {
  readonly declared: readonly FieldOfView[];
  /** Gates that select their own subject, enumerated by the caller. */
  readonly gates: readonly string[];
  /** Control ids present in `scripts/sabotage.mjs`. */
  readonly controls: readonly string[];
}): FieldOfViewReport {
  const { declared, gates, controls } = input;
  if (gates.length === 0) {
    // An empty inventory makes every difference below come out clean, which is
    // the permissive answer to a question nobody asked. §13's empty-container
    // rule: fail closed or throw.
    throw new Error('assessFieldOfView: the gate inventory is empty');
  }
  const declaredNames = new Set(declared.map((d) => d.gate));
  const controlSet = new Set(controls);
  const regions = declared.flatMap((d) => d.blindTo.map((b) => ({ gate: d.gate, ...b })));

  return {
    undeclared: gates.filter((g) => !declaredNames.has(g)).sort(),
    stale: [...declaredNames].filter((g) => !gates.includes(g)).sort(),
    unproven: regions
      .filter((r) => r.coveredBy === null && (r.provenBy ?? '') === '')
      .map((r) => `${r.gate}: ${r.region}`)
      .sort(),
    danglingProof: regions
      .filter((r) => r.provenBy !== undefined && !controlSet.has(r.provenBy))
      .map((r) => `${r.gate}: ${r.provenBy}`)
      .sort(),
    proofWithoutHole: regions
      .filter((r) => r.provenBy !== undefined && r.coveredBy !== null)
      .map((r) => `${r.gate}: ${r.region}`)
      .sort(),
    danglingCover: regions
      .filter((r) => r.coveredBy !== null && !declaredNames.has(r.coveredBy))
      .map((r) => `${r.gate}: ${r.coveredBy}`)
      .sort(),
  };
}
