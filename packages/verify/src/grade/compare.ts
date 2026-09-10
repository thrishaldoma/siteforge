/**
 * Comparing two gradings, and refusing to when they are not about the same
 * thing (decision 0053).
 *
 * Two halves, and they are one module because the second is worthless without
 * the first:
 *
 * 1. **`assessGradeComparability`** — a gate. Two reports of two different
 *    instances, or scored by two different contracts, do not compare, and the
 *    refusal is the *primary* path rather than a warning printed above a table.
 *    0019's rule: where "refused" and "compared" both render a delta, the wrong
 *    answer is already the answer.
 *
 * 2. **`decomposeMovement`** — a rate is not a result until you know which of
 *    its three numbers moved. `field-type` cleared its 0.90 gate at 0.9433 with
 *    a miss count byte-identical at 25, on a denominator that went 250 → 441.
 *    Nothing improved, and the rate alone said the opposite.
 *
 * Everything takes its inputs as parameters (§13), so both halves can be driven
 * to a failing verdict on two hand-written reports.
 */
import {
  GRADE_METRICS,
  sameSeedState,
  seedStateLabel,
  type GradeRun,
  type GradeRunMetric,
} from '@siteforge/schema';

// ---------------------------------------------------------------------------
// Which direction is better, and the five metrics where nothing says
// ---------------------------------------------------------------------------

/**
 * The reported-only metrics, and which way each reads.
 *
 * A gated metric's direction is `gate.direction` and is already part of the
 * contract digest. A **reported-only** metric has no gate to read it off, and
 * defaulting to "higher is better" would be a guess that is right until it is
 * not — `auth.unprobeable-count` is a count of operations no probe can settle,
 * and higher is worse.
 *
 * Declared here rather than in the contract table on purpose: nothing about
 * *what is measured* changes, so `METRICS_VERSION` and the contract digest do
 * not move. A digest bump would say a threshold or a denominator had changed.
 *
 * The set is asserted **equal** to the gateless set (§13's freeze rule: a
 * complete set, never the absence of a known-bad member), so a reported-only
 * metric added tomorrow fails the suite until someone decides which way it
 * reads.
 */
export const REPORTED_ONLY_POLARITY: ReadonlyMap<string, 'higher-is-better' | 'lower-is-better'> =
  new Map([
    ['path-param-naming.accuracy', 'higher-is-better'],
    ['response-field-presence.seed-coverage', 'higher-is-better'],
    ['narrowing.recall', 'higher-is-better'],
    ['auth.truth-coverage', 'higher-is-better'],
    /** The one that is not "higher is better", and the reason the set is declared. */
    ['auth.unprobeable-count', 'lower-is-better'],
    ['entity-identity.recall', 'higher-is-better'],
    ['entity-relation.precision', 'higher-is-better'],
    ['entity-relation.recall', 'higher-is-better'],
    ['entity-narrowing.recall', 'higher-is-better'],
  ]);

export type Polarity = 'higher-is-better' | 'lower-is-better';

/**
 * Which way a metric reads.
 *
 * Throws for a metric that is neither gated nor declared, rather than assuming.
 * An undeclared polarity is a `misses` count computed the wrong way round, and
 * a miss count with the sign flipped reads exactly like a real improvement.
 */
export function polarityOf(metric: Pick<GradeRunMetric, 'id' | 'gate'>): Polarity {
  if (metric.gate !== null) {
    return metric.gate.direction === 'atLeast' ? 'higher-is-better' : 'lower-is-better';
  }
  const declared = REPORTED_ONLY_POLARITY.get(metric.id);
  if (declared === undefined) {
    throw new Error(
      `${metric.id} has no gate and no declared polarity, so its miss count cannot be computed. ` +
        'Add it to REPORTED_ONLY_POLARITY — the direction has to be a decision, not a default.',
    );
  }
  return declared;
}

/**
 * How many the metric got wrong.
 *
 * The number a rate hides. For a higher-is-better rate it is the shortfall;
 * for a lower-is-better one the numerator *is* the bad count, which is why the
 * direction has to be known rather than assumed.
 */
export function missesOf(metric: Pick<GradeRunMetric, 'id' | 'gate' | 'numerator' | 'denominator'>): number {
  return polarityOf(metric) === 'higher-is-better'
    ? metric.denominator - metric.numerator
    : metric.numerator;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** Why two gradings do not compare. Each is a way they are about different things. */
export type IncomparabilityKind =
  /** Different instances. The seed changed what the crawl could reach (0051). */
  | 'seed-state-differs'
  /** One or both captures recorded no seed, so nothing says the target held still. */
  | 'seed-state-unrecorded'
  /** Two contracts are two definitions of the same metric names. */
  | 'metrics-version-differs'
  | 'contract-digest-differs'
  /** Two targets. A delta between them is not a delta. */
  | 'site-differs';

export interface Incomparability {
  readonly kind: IncomparabilityKind;
  readonly detail: string;
}

/**
 * What moved, for one metric present in both reports.
 *
 * All three numbers, never just the rate — that is the whole point of the
 * decomposition. `value` may be `null` on either side (vacuous), and a metric
 * that became vacuous or stopped being vacuous is reported as such rather than
 * as a numeric delta over a `null`.
 */
export interface MetricMovement {
  readonly id: string;
  readonly before: GradeRunMetric;
  readonly after: GradeRunMetric;
  readonly numeratorDelta: number;
  readonly denominatorDelta: number;
  readonly missesBefore: number;
  readonly missesAfter: number;
  readonly missesDelta: number;
  readonly valueDelta: number | null;
  /** `false → true` on the gate. What a reader is usually looking for. */
  readonly crossedIntoPassing: boolean;
  readonly crossedIntoFailing: boolean;
  readonly findings: readonly MovementFinding[];
}

/**
 * A movement that is not the movement it looks like.
 *
 * Deliberately wider than the case that motivated it. 0051 §4.2 is
 * `rate-rose-while-misses-did-not-fall`; 0045 §1.2 holds two more where the
 * denominator *shrank* under a crossing gate, and a rule keyed only on flat
 * misses passes both of them. A rule written against the single case its author
 * had in mind is the vacuity mode this repository keeps finding.
 */
export type MovementFindingKind =
  /**
   * The metric crossed its gate while its denominator changed at all.
   *
   * No threshold, and nothing to tune: a gate crossed on a population that is
   * not the same population is not a like-for-like result, whichever way the
   * denominator went.
   */
  | 'gate-crossed-on-a-changed-denominator'
  /**
   * The rate moved and the absolute count of wrong answers did not follow.
   *
   * Both directions, and the second was found by sweeping the record with the
   * first: 0051's `field-type` rose 0.9000 → 0.9433 with misses flat at 25, and
   * 0046's `response-field-presence.precision` *fell* 0.4538 → 0.4207 with
   * misses **byte-identical at 325**. One reads as an improvement and the other
   * as a regression; neither is either, and both are the denominator moving.
   */
  | 'rate-moved-against-its-miss-count'
  /** A number that can only move via one specific defect moved (0015 §3). */
  | 'conservation-check-moved'
  /** One side has no number. A delta over a vacuous metric is not a delta. */
  | 'vacuity-changed';

export interface MovementFinding {
  readonly kind: MovementFindingKind;
  readonly detail: string;
}

export interface GradeComparison {
  readonly comparable: true;
  readonly seedState: string;
  readonly movements: readonly MetricMovement[];
  /** Metrics in one report and not the other — a contract that moved under a shared digest. */
  readonly onlyBefore: readonly string[];
  readonly onlyAfter: readonly string[];
  /** Every finding across every metric, so a caller cannot render the table and miss them. */
  readonly findings: readonly (MovementFinding & { readonly metric: string })[];
}

export type GradeComparabilityResult =
  | GradeComparison
  | { readonly comparable: false; readonly refusals: readonly Incomparability[] };

/**
 * Compare two gradings, or refuse.
 *
 * Refusals are collected rather than short-circuited: a caller that changed the
 * seed *and* the contract should be told both, or it fixes one and meets the
 * other on the next run.
 */
export function assessGradeComparability(input: {
  readonly before: GradeRun;
  readonly after: GradeRun;
}): GradeComparabilityResult {
  const { before, after } = input;
  const refusals: Incomparability[] = [];

  if (before.siteId !== after.siteId) {
    refusals.push({
      kind: 'site-differs',
      detail: `'${before.siteId}' and '${after.siteId}' are two targets; a delta between them is not a delta.`,
    });
  }
  if (before.seedState.source !== 'fixture-seed' || after.seedState.source !== 'fixture-seed') {
    refusals.push({
      kind: 'seed-state-unrecorded',
      detail:
        `${before.seedState.source === 'fixture-seed' ? 'the later' : 'the earlier'} capture records no fixture seed ` +
        `(${seedStateLabel(before.seedState)} → ${seedStateLabel(after.seedState)}), so nothing says the target held still between them.`,
    });
  } else if (!sameSeedState(before.seedState, after.seedState)) {
    refusals.push({
      kind: 'seed-state-differs',
      detail:
        `${seedStateLabel(before.seedState)} → ${seedStateLabel(after.seedState)}. The seed changes what the crawl can ` +
        'reach, not only what the fields hold (0051 §4), so these are two instances and every denominator is free to move.',
    });
  }
  if (before.metricsVersion !== after.metricsVersion) {
    refusals.push({
      kind: 'metrics-version-differs',
      detail: `metrics v${before.metricsVersion} → v${after.metricsVersion}: two contracts are two definitions of the same metric names.`,
    });
  } else if (before.contractDigest !== after.contractDigest) {
    refusals.push({
      kind: 'contract-digest-differs',
      detail:
        `contract ${before.contractDigest.slice(0, 12)}… → ${after.contractDigest.slice(0, 12)}… at the same version. ` +
        'A threshold or a denominator moved without the version saying so.',
    });
  }

  if (refusals.length > 0) return { comparable: false, refusals };

  const beforeById = new Map(before.metrics.map((m) => [m.id, m]));
  const afterById = new Map(after.metrics.map((m) => [m.id, m]));
  const movements: MetricMovement[] = [];
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (a !== undefined) movements.push(decomposeMovement(b, a));
  }

  return {
    comparable: true,
    seedState: seedStateLabel(after.seedState),
    movements,
    onlyBefore: [...beforeById.keys()].filter((id) => !afterById.has(id)),
    onlyAfter: [...afterById.keys()].filter((id) => !beforeById.has(id)),
    findings: movements.flatMap((m) => m.findings.map((f) => ({ ...f, metric: m.id }))),
  };
}

/**
 * One metric's movement, decomposed into the three numbers that produced it.
 *
 * Takes two metrics rather than two reports, so the decomposition can be driven
 * without constructing a report around it.
 */
export function decomposeMovement(before: GradeRunMetric, after: GradeRunMetric): MetricMovement {
  const missesBefore = missesOf(before);
  const missesAfter = missesOf(after);
  const denominatorDelta = after.denominator - before.denominator;
  const crossedIntoPassing = !before.passed && after.passed;
  const crossedIntoFailing = before.passed && !after.passed;
  const findings: MovementFinding[] = [];

  if (before.vacuous !== after.vacuous) {
    findings.push({
      kind: 'vacuity-changed',
      detail: before.vacuous
        ? `was vacuous and now scores ${after.numerator}/${after.denominator}: this is a first measurement, not an improvement.`
        : `scored ${before.numerator}/${before.denominator} and is now vacuous: the population it was over has gone.`,
    });
  }

  if (crossedIntoPassing && denominatorDelta !== 0) {
    findings.push({
      kind: 'gate-crossed-on-a-changed-denominator',
      detail:
        `crossed its gate while the denominator went ${before.denominator} → ${after.denominator} ` +
        `(${denominatorDelta > 0 ? '+' : ''}${denominatorDelta}). The population is not the same population, so this is not ` +
        `a like-for-like pass. Misses ${missesBefore} → ${missesAfter}.`,
    });
  }

  /**
   * Did the rate move in a direction its own miss count does not support?
   *
   * Symmetric on purpose. An improvement the misses do not back is a pass
   * nobody earned; a regression the misses do not back is a scare nobody
   * caused. Both are a denominator moving, and only the first was in the case
   * that motivated the rule.
   */
  if (before.value !== null && after.value !== null && after.value !== before.value) {
    const better = polarityOf(after) === 'higher-is-better' ? after.value > before.value : after.value < before.value;
    const supported = better ? missesAfter < missesBefore : missesAfter > missesBefore;
    if (!supported) {
      findings.push({
        kind: 'rate-moved-against-its-miss-count',
        detail:
          `the rate ${better ? 'improved' : 'worsened'} while misses went ${missesBefore} → ${missesAfter}, ` +
          `which does not ${better ? 'fall' : 'rise'}. The denominator went ${before.denominator} → ${after.denominator}; ` +
          'that is what moved, and the rate is reporting it as a change in quality.',
      });
    }
  }

  if (before.conservation !== undefined && (before.numerator !== after.numerator || denominatorDelta !== 0)) {
    findings.push({
      kind: 'conservation-check-moved',
      detail:
        `a conservation check moved ${before.numerator}/${before.denominator} → ${after.numerator}/${after.denominator}. ` +
        `It can only move via one defect: ${before.conservation}`,
    });
  }

  return {
    id: before.id,
    before,
    after,
    numeratorDelta: after.numerator - before.numerator,
    denominatorDelta,
    missesBefore,
    missesAfter,
    missesDelta: missesAfter - missesBefore,
    valueDelta: before.value !== null && after.value !== null ? after.value - before.value : null,
    crossedIntoPassing,
    crossedIntoFailing,
    findings,
  };
}

/**
 * The gateless metrics, from the contract itself.
 *
 * Exported so the test asserts the declared polarity set **equals** this rather
 * than merely containing no unknown entry.
 */
export const gatelessMetricIds = (): readonly string[] =>
  GRADE_METRICS.filter((m) => m.gate === null).map((m) => m.id);
