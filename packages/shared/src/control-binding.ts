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
 *
 * ### Within a rung, iteration order never decides either (0042)
 *
 * Ranking fixes precedence *between* rungs and says nothing about a rung that
 * matches two candidates. Rank 5 of §7.6 shipped taking the first path-like
 * `data-*` attribute, so `Object.entries` order picked the binding — the same
 * unreviewable-by-construction defect the duplicate-rank throw exists to
 * prevent, one level down, in the turn that implemented the rule.
 *
 * The fix is structural rather than a patch to that rung: **a rung cannot pick,
 * because it never holds the choice.** `run` returns *every* match, and the
 * evaluator resolves:
 *
 *  - one candidate  → bind it;
 *  - several, and the rung declares a `tiebreak` → sort and bind the first,
 *    recording that a tiebreak was applied;
 *  - several, and no tiebreak → an **ambiguous decline**, reported with all of
 *    them. 0015 §2 already settled this shape for endpoint matching: an
 *    ambiguity is reported, never resolved by picking the better one;
 *  - several, a tiebreak is declared, and it **ties** → also ambiguous. A
 *    comparator that returns 0 has not decided, and falling back to array
 *    order there would reintroduce the bug through the fix.
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

/** One thing a rung matched. A rung may match several; it may not choose. */
export interface BindingCandidate<T extends BindingTarget> {
  readonly target: T;
  readonly detail: string;
}

export type RungVerdict<T extends BindingTarget> =
  | { readonly kind: 'bind'; readonly candidates: readonly BindingCandidate<T>[] }
  | { readonly kind: 'decline'; readonly reason: string; readonly detail: string }
  | null;

export interface BindingRung<C, T extends BindingTarget> {
  readonly rank: number;
  readonly id: string;
  /**
   * How to order several matches, when the rung has a principled way to.
   *
   * Optional, and its absence is the safe state: without it several matches
   * are an ambiguous decline rather than a coin flip. Declaring one is a
   * claim that the order is an argument, so it carries `tiebreakReason` and
   * the evaluator refuses a comparator with no reason — the same shape as
   * every other declared exemption in this repository.
   */
  readonly tiebreak?: (a: BindingCandidate<T>, b: BindingCandidate<T>) => number;
  readonly tiebreakReason?: string;
  /**
   * Every match, never a chosen one. `null` when this rung has nothing to say
   * about this control; `{kind:'bind', candidates: []}` is not a thing — a
   * rung that matched nothing is silent.
   */
  run(control: C): RungVerdict<T>;
}

/** A control the ranking bound. */
export interface ControlBinding<T extends BindingTarget> {
  /** Set when several candidates matched and a declared tiebreak chose. */
  readonly tiebrokenFrom?: number;
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
 * Turn a rung's matches into a single verdict, or refuse to.
 *
 * This is where "iteration order never decides" is enforced, and it is here
 * rather than in each rung because a rung that could choose would eventually
 * choose. The rung reports what it saw; this decides what that means.
 */
type Resolved<T extends BindingTarget> =
  | { readonly kind: 'bind'; readonly target: T; readonly detail: string; readonly tiebrokenFrom?: number }
  | { readonly kind: 'decline'; readonly reason: string; readonly detail: string };

function resolveCandidates<C, T extends BindingTarget>(
  rung: BindingRung<C, T>,
  verdict: NonNullable<RungVerdict<T>>,
): Resolved<T> {
  if (verdict.kind === 'decline') return verdict;
  const candidates = verdict.candidates;
  if (candidates.length === 0) {
    throw new Error(
      `rung '${rung.id}' returned a bind with no candidates. A rung that matched nothing is ` +
      'silent (`null`); an empty bind is the empty-container shape §13 forbids, and it would ' +
      'record the rung as having fired.',
    );
  }
  if (candidates.length === 1) {
    return { kind: 'bind', target: candidates[0]!.target, detail: candidates[0]!.detail };
  }
  const listed = candidates.map((c) => c.detail).join(' · ');
  if (rung.tiebreak === undefined) {
    return {
      kind: 'decline',
      reason: 'ambiguous-candidates',
      detail: `${rung.id} matched ${candidates.length}: ${listed}. Nothing here says which the control uses, and taking the first would make iteration order decide.`,
    };
  }
  const sorted = [...candidates].sort(rung.tiebreak);
  // A comparator that returns 0 has not decided. Falling back to array order
  // for the tie would put the bug back in through the fix.
  if (rung.tiebreak(sorted[0]!, sorted[1]!) === 0) {
    return {
      kind: 'decline',
      reason: 'tiebreak-tied',
      detail: `${rung.id}'s tiebreak (${rung.tiebreakReason}) does not separate ${candidates.length} matches: ${listed}`,
    };
  }
  return {
    kind: 'bind',
    target: sorted[0]!.target,
    detail: `${sorted[0]!.detail} (chosen from ${candidates.length} by ${rung.tiebreakReason})`,
    tiebrokenFrom: candidates.length,
  };
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

  for (const rung of input.rungs) {
    if (rung.tiebreak !== undefined && (rung.tiebreakReason ?? '').trim().length === 0) {
      throw new Error(
        `rung '${rung.id}' declares a tiebreak with no reason. A tiebreak is a claim that ` +
        'the order between two matches is an argument rather than an accident, and an ' +
        'undeclared one is indistinguishable from taking the first.',
      );
    }
  }

  const bound: ControlBinding<T>[] = [];
  const declined: ControlDecline[] = [];
  const unbound: string[] = [];
  const fired = new Set<string>();

  for (const control of input.controls) {
    const evidence: BindingEvidence[] = [];
    let decision: { rung: BindingRung<C, T>; verdict: Resolved<T> } | null = null;

    for (const rung of rungs) {
      const raw = rung.run(control);
      if (raw === null) continue;
      const verdict = resolveCandidates(rung, raw);
      fired.add(rung.id);
      evidence.push({
        rank: rung.rank,
        rung: rung.id,
        detail: verdict.kind === 'bind' ? verdict.detail : verdict.detail,
      });
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
      ...(decision.verdict.tiebrokenFrom === undefined
        ? {}
        : { tiebrokenFrom: decision.verdict.tiebrokenFrom }),
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
