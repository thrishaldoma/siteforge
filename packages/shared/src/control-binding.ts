/**
 * Binding an unbound control to the thing it reaches (0030, 0041).
 *
 * Two problems in this repository have the same shape and different targets:
 *
 * | | the control | the target |
 * |---|---|---|
 * | **§7.6** | one capture never fired (`flows/skipped-controls.json`) | a **URL** |
 * | select binding | one capture *saw* but cannot key (unnamed `<select>`s) | an API **field** |
 *
 * 0030 §1 settled what "one mechanism" means: **the shared thing is a record,
 * not a function.** The rungs genuinely differ — a URL binding reads DOM
 * attributes, a field binding compares option values against observed request
 * values — and a shared docstring over two implementations is §13's schema
 * drift wearing a different hat. So this module owns the record and the ranked
 * evaluator; each problem supplies its own rung table.
 *
 * ### The ladder rule, which is the whole reason this is shaped as a list
 *
 * 0033 §4.2: **no precondition above the ranked branches. A condition that can
 * veto the top branch is a ranked entry.** `ENUM_TOKEN` sat in a "hard
 * exclusion, regardless of the above" tier above §7.5's ranking and vetoed the
 * ladder's own primary evidence for the life of the project, invisible to every
 * reading of the ranking because it was above the part anyone reviews.
 *
 * So this evaluator has **no filter stage**. Out-of-scope determinations are
 * rungs, and they outrank the extractors because they answer a *prior* question
 * — is this ours, is this even a control — exactly as §7.5's rank 1 outranks
 * the UI-constraint rung by deciding whether the field is a key at all.
 *
 * ### Three verdicts, and the three-way is load-bearing
 *
 * A rung returns `bind` (a target), `decline` (this control gets no target,
 * ever — a *decided* outcome) or `null` (this rung has nothing to say).
 * Collapsing decline into null would let an out-of-scope control fall through
 * to a weaker rung and bind anyway, which is the failure the ranking exists to
 * prevent: a `<form action="https://external/">` is a rank-3 hit and still not
 * ours.
 */

/** What a URL rung binds to. Method is evidence-derived, never guessed. */
export interface UrlTarget {
  readonly kind: 'url';
  /** Same-origin path, normalised by the caller. */
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
}

/** What a field rung binds to (0030). Declared here; no rungs produce it yet. */
export interface FieldTarget {
  readonly kind: 'field';
  readonly endpointId: string;
  readonly pointer: string;
}

export type BindingTarget = UrlTarget | FieldTarget;

/** One rung's finding, kept whether or not it won. */
export interface BindingEvidence {
  readonly rank: number;
  readonly rung: string;
  readonly detail: string;
}

export type RungVerdict<T extends BindingTarget> =
  | { readonly kind: 'bind'; readonly target: T; readonly detail: string }
  | { readonly kind: 'decline'; readonly reason: string; readonly detail: string }
  | null;

export interface BindingRung<C, T extends BindingTarget> {
  readonly rank: number;
  readonly id: string;
  /**
   * `null` when this rung has nothing to say about this control. Never a
   * default — a rung that cannot decide says so, and the next rank runs.
   */
  run(control: C): RungVerdict<T>;
}

/** A control the ranking bound. */
export interface ControlBinding<T extends BindingTarget> {
  readonly controlId: string;
  readonly target: T;
  /** Every rung that fired, in rank order — not only the winner. */
  readonly evidence: readonly BindingEvidence[];
  /** The rank that decided. */
  readonly rank: number;
  readonly gapId: string;
}

/** A control the ranking refused, with the rung that refused it. */
export interface ControlDecline {
  readonly controlId: string;
  readonly rank: number;
  readonly rung: string;
  readonly reason: string;
  readonly detail: string;
}

export interface BindingReport<T extends BindingTarget> {
  readonly bound: readonly ControlBinding<T>[];
  readonly declined: readonly ControlDecline[];
  /** No rung had anything to say. The capture gap stands alone (§7.6). */
  readonly unbound: readonly string[];
  /** Controls in. Reported so "nothing bound" and "nothing was offered" differ (0019). */
  readonly considered: number;
  /** Rungs declared but never firing on this input, by id — a rung nobody can prove fires. */
  readonly silentRungs: readonly string[];
}

/**
 * Run the ranked rungs over each control.
 *
 * Every rung is run, in rank order, even after one has decided — because the
 * record keeps *every* rung that fired. `NarrowingRecord`'s rule: a derived
 * field carries the evidence it was derived from, and "rank 2 agreed with rank
 * 4" is a different claim from "rank 2 fired" (0030 §1).
 */
export function assessControlBindings<C extends { controlId: string; gapId: string }, T extends BindingTarget>(input: {
  readonly controls: readonly C[];
  readonly rungs: readonly BindingRung<C, T>[];
}): BindingReport<T> {
  const ranks = input.rungs.map((r) => r.rank);
  if (new Set(ranks).size !== ranks.length) {
    throw new Error(
      `two rungs share a rank (${ranks.join(', ')}). A ranking whose order is ambiguous is ` +
      'the unranked-veto bug with extra steps: which of the two decides becomes a property ' +
      'of array order rather than of the argument. 0033 §4.2.',
    );
  }
  // Ordered here rather than trusting the caller's array order, so a rung's
  // position in a literal cannot silently outrank its declared number.
  const rungs = [...input.rungs].sort((a, b) => a.rank - b.rank);

  const bound: ControlBinding<T>[] = [];
  const declined: ControlDecline[] = [];
  const unbound: string[] = [];
  const fired = new Set<string>();

  for (const control of input.controls) {
    const evidence: BindingEvidence[] = [];
    let decision: { rung: BindingRung<C, T>; verdict: NonNullable<RungVerdict<T>> } | null = null;

    for (const rung of rungs) {
      const verdict = rung.run(control);
      if (verdict === null) continue;
      fired.add(rung.id);
      evidence.push({ rank: rung.rank, rung: rung.id, detail: verdict.detail });
      // First to speak decides; the rest still run, and still record.
      if (decision === null) decision = { rung, verdict };
    }

    if (decision === null) {
      unbound.push(control.controlId);
      continue;
    }
    if (decision.verdict.kind === 'decline') {
      declined.push({
        controlId: control.controlId,
        rank: decision.rung.rank,
        rung: decision.rung.id,
        reason: decision.verdict.reason,
        detail: decision.verdict.detail,
      });
      continue;
    }
    bound.push({
      controlId: control.controlId,
      target: decision.verdict.target,
      evidence,
      rank: decision.rung.rank,
      gapId: control.gapId,
    });
  }

  return {
    bound,
    declined,
    unbound,
    considered: input.controls.length,
    silentRungs: rungs.filter((r) => !fired.has(r.id)).map((r) => r.id),
  };
}
