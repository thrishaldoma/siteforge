/**
 * Which probes contaminate which, measured rather than assumed (0043 §4).
 *
 * §6 requires that "probes cannot contaminate each other's preconditions" and
 * implements it as a fresh *page context* per probe. 0032 §2.1 measured that
 * this is not sufficient and §6 itself says why: "a fresh page context does not
 * undo a mutation" — the browser is reset, the server is not. So the pass is
 * non-independent, and 0043 ruled (a): reset target state between probes.
 *
 * **Reset granularity is the open design question, and it is a measurement
 * rather than a principle.** Per-probe reset is the strong form and may be
 * prohibitively slow against a container; per-route may be enough. The two
 * differ in exactly one observable:
 *
 * | contamination scope | what it means | granularity it forces |
 * |---|---|---|
 * | **within-route** | probe k on route R reads probe j<k's writes | **per-probe** — a route boundary is too coarse to help |
 * | **cross-route only** | route R2's probes read route R1's writes, but a route's own probes do not disturb each other | **per-route** is sufficient |
 *
 * This module answers the first from a single run. The second needs the
 * cross-run series, because it shows up as a route's *first* probe seeing a
 * different pre-state between runs.
 *
 * ### The signal, and why it is two hashes rather than one
 *
 * Each probe loads its route fresh and snapshots before clicking. Absent
 * contamination, every probe on one route sees the *same* pre-state, so the
 * sequence of pre-hashes down a route is constant. A change means something
 * between probe k−1 and probe k altered what the route renders.
 *
 * A single hash over `outerHTML` cannot say *what* changed, and this target has
 * a competing explanation: §6's shim freezes our clock, not the server's, so a
 * server-written timestamp rendered as relative text moves on its own. That
 * would read as contamination and is not.
 *
 * So the fingerprint is split, per §13's "test a structural property
 * structurally":
 *
 *  - **structure** — the element tag sequence. A created or deleted row moves
 *    it; a re-rendered timestamp does not.
 *  - **text** — the full serialisation. Moves for either.
 *
 * `structure` moved ⇒ a row appeared or vanished. Only `text` moved ⇒ the
 * server clock, and it is reported separately rather than counted.
 *
 * ### The negative control, which is the half that makes this falsifiable
 *
 * §13: every mutation harness carries at least one perturbation that must
 * **not** move the thing it names. Here it is free, because the pass supplies
 * it: **a probe whose network calls were all reads must not move the next
 * probe's pre-state.** If structure drifts across a purely-read prefix, the
 * drift is not contamination and every reading downstream of it is confounded —
 * found from inside the instrument rather than argued about afterwards.
 *
 * And the mirror, because a silent instrument reads exactly like a clean pass:
 * if probes mutated and *nothing* ever drifted, the fingerprint is not seeing
 * writes and the verdict is about this module, not about the crawler.
 */

/** One probe's pre-state, in the order the route's loop ran them. */
export interface ProbeObservation {
  readonly routeId: string;
  /** Position in this route's probe loop. The variable the failure rate depends on (0026). */
  readonly attemptIndex: number;
  readonly label: string;
  /**
   * Tag sequence and full serialisation of the freshly-loaded route.
   *
   * `null` when the probe never got far enough to snapshot — abandoned on the
   * deadline, or the control was not on the reloaded page. Kept in the list
   * rather than dropped: a gap in the sequence is why two neighbours are not
   * actually neighbours, and silently closing it would compare across it.
   */
  readonly preStructureHash: string | null;
  readonly preTextHash: string | null;
  /** This probe issued at least one non-GET. Derived from its recorded calls, never guessed. */
  readonly mutated: boolean;
  /**
   * Calls attributed to this probe, and the methods among them.
   *
   * Carried so `mutated: false` can be told from "this probe was never
   * credited with any traffic" — the two are the same field value and
   * completely different facts, and conflating them is how a pass that
   * demonstrably writes reported no writes at all.
   */
  readonly calls?: number;
  readonly methods?: readonly string[];
}

export interface DriftPoint {
  readonly routeId: string;
  readonly fromAttemptIndex: number;
  readonly toAttemptIndex: number;
  /** Whether any probe at or before `fromAttemptIndex` on this route mutated. */
  readonly afterMutating: boolean;
  readonly kind: 'structure' | 'text-only';
}

export type ContaminationVerdict =
  /** Structure drifts within a route, downstream of a write. A route boundary is too coarse. */
  | 'per-probe-required'
  /** No within-route drift, and the instrument demonstrably sees writes. Per-route may suffice. */
  | 'no-within-route-contamination'
  /** Structure drifted with no write to explain it. The reading is confounded; do not choose on it. */
  | 'confounded'
  /** Writes happened and nothing moved. This module is not measuring what it claims. */
  | 'instrument-silent'
  /** Nothing to compare. Not a result. */
  | 'no-comparable-pairs';

export interface ContaminationReport {
  readonly verdict: ContaminationVerdict;
  readonly detail: string;
  /** Adjacent pairs actually compared — both sides snapshotted, same route. */
  readonly comparedPairs: number;
  /** Pairs skipped because a probe never snapshotted. Reported so nothing-compared ≠ nothing-wrong (0019). */
  readonly skippedPairs: number;
  readonly mutatingProbes: number;
  readonly structureDrift: readonly DriftPoint[];
  readonly textOnlyDrift: readonly DriftPoint[];
  /** Structure drift with no preceding write on the route. The negative control failing. */
  readonly unexplainedDrift: readonly DriftPoint[];
  /** Routes whose structure drifted, in the order first seen. */
  readonly contaminatedRoutes: readonly string[];
}

/**
 * Assess one run's probe pass for within-route contamination.
 *
 * Takes the observations as a parameter, so a test can drive every verdict
 * without a crawl — §13's rule that a gate's judgement is separable from its
 * wiring, which is the root the three vacuity modes share.
 */
export function assessProbeContamination(input: {
  readonly probes: readonly ProbeObservation[];
}): ContaminationReport {
  const byRoute = new Map<string, ProbeObservation[]>();
  for (const p of input.probes) {
    const list = byRoute.get(p.routeId);
    if (list === undefined) byRoute.set(p.routeId, [p]);
    else list.push(p);
  }

  const structureDrift: DriftPoint[] = [];
  const textOnlyDrift: DriftPoint[] = [];
  let comparedPairs = 0;
  let skippedPairs = 0;

  for (const [routeId, unordered] of byRoute) {
    // Ordered by the declared index, never by array order — the artifact's own
    // ordering is not a guarantee, and iteration order must never decide (0042).
    const probes = [...unordered].sort((a, b) => a.attemptIndex - b.attemptIndex);
    let mutatedSoFar = false;
    for (let i = 1; i < probes.length; i += 1) {
      const prev = probes[i - 1]!;
      const cur = probes[i]!;
      if (prev.mutated) mutatedSoFar = true;
      if (prev.preStructureHash === null || cur.preStructureHash === null) {
        skippedPairs += 1;
        continue;
      }
      comparedPairs += 1;
      const point = {
        routeId,
        fromAttemptIndex: prev.attemptIndex,
        toAttemptIndex: cur.attemptIndex,
        afterMutating: mutatedSoFar,
      };
      if (prev.preStructureHash !== cur.preStructureHash) {
        structureDrift.push({ ...point, kind: 'structure' });
      } else if (prev.preTextHash !== cur.preTextHash) {
        textOnlyDrift.push({ ...point, kind: 'text-only' });
      }
    }
  }

  const mutatingProbes = input.probes.filter((p) => p.mutated).length;
  const unexplainedDrift = structureDrift.filter((d) => !d.afterMutating);
  const contaminatedRoutes = [...new Set(structureDrift.map((d) => d.routeId))];

  const report = {
    comparedPairs, skippedPairs, mutatingProbes,
    structureDrift, textOnlyDrift, unexplainedDrift, contaminatedRoutes,
  };

  // Ordered so that the two ways of learning nothing are reported as such
  // rather than as one of the two answers the granularity choice needs.
  if (comparedPairs === 0) {
    return {
      ...report,
      verdict: 'no-comparable-pairs',
      detail: `no adjacent probe pair on any route had both pre-states recorded (${skippedPairs} pair(s) skipped). Nothing was compared, which is not the same as nothing being wrong.`,
    };
  }
  if (mutatingProbes === 0) {
    // Before `confounded`, deliberately. With no write anywhere, "the negative
    // control failed" is the wrong description of what happened — there was no
    // positive case for it to be a control *against*, and reporting a failed
    // control would send the reader looking for a confound in the fingerprint
    // when the thing to check is why a pass that demonstrably writes reported
    // no writes. Measured: a crawl attributed 0 writes to 128 probes while
    // observing `POST /user/settings/general` and `POST /tasks/1` from the
    // browser, because the attribution ran too late in a probe's life to
    // survive one that timed out after clicking.
    return {
      ...report,
      verdict: 'instrument-silent',
      detail: `${comparedPairs} pair(s) compared and not one of ${input.probes.length} probe(s) is recorded as having written. Either the pass genuinely mutates nothing — in which case it cannot contaminate anything and the granularity question is moot — or the write attribution is not seeing writes. Check the probe-attributed call count against the crawl-wide one before reading anything else here.`,
    };
  }
  if (unexplainedDrift.length > 0) {
    return {
      ...report,
      verdict: 'confounded',
      detail: `${unexplainedDrift.length} of ${structureDrift.length} structural drift point(s) had no write before them on the route — the negative control failed, so structure here moves for a reason other than a probe's writes and the granularity choice must not be made on this reading.`,
    };
  }
  if (structureDrift.length > 0) {
    return {
      ...report,
      verdict: 'per-probe-required',
      detail: `${structureDrift.length} structural drift point(s) across ${contaminatedRoutes.length} route(s), every one downstream of a write. Probes on one route disturb each other, so resetting at the route boundary would leave the contamination in place.`,
    };
  }
  return {
    ...report,
    verdict: 'no-within-route-contamination',
    detail: `${comparedPairs} pair(s) compared, ${mutatingProbes} probe(s) issued writes, and no route's structure moved. Within-route reset is not what the evidence asks for; cross-route contamination is a separate question the single-run view cannot see.`,
  };
}
