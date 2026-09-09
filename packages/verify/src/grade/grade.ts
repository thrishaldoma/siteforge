/**
 * The grader (0015 §3–§6).
 *
 * It reads a `SiteModel`, a ground-truth snapshot and the endpoint list capture
 * observed, and reports per-category precision and recall. It imports nothing
 * from `packages/infer`, which does not exist — that is the point of writing it
 * now, and a test asserts the import list rather than the absence of one name.
 *
 * Three properties are structural rather than stylistic:
 *
 * 1. **Everything arrives as a parameter.** The real run is one caller and the
 *    mutation harness in `./mutations.ts` is the other. Because the grader is a
 *    pure function, 0015 §8's "applied, measured, reverted" is a data transform
 *    rather than a git patch — the perturbation is a different argument, not a
 *    different working tree.
 * 2. **There is no overall score.** §13: an aggregate lets a partial loss hide
 *    inside a surviving total. The gate is a conjunction over categories.
 * 3. **A zero denominator is a scored outcome, not an exception.** `TP/(TP+FP)`
 *    with no predictions is conventionally 1.0, so a category nobody exercised
 *    would report perfect. Every metric here carries `vacuous` and the
 *    denominator that was empty, the value is `null` rather than a number, and
 *    the gate treats vacuous as failure.
 */
import {
  GRADE_CATEGORIES,
  GRADE_CONTRACT_DIGEST,
  GRADE_METRICS,
  METRICS_VERSION,
  assessDivergenceBudget,
  resolveAuthForCodegen,
  type DivergenceBudget,
  type GradeCategoryId,
  type GradeMetric,
  type JsonSchemaNode,
  type KnownDivergence,
  type SiteModel,
} from '@siteforge/schema';
import { matchEndpoints, type Matching, type MatchedPair, type ObservedEndpoint } from './match.js';
import { modelFieldPointers, typeAgrees } from './fields.js';
import { isExpressibleFormat } from './vocabulary.js';
import type { TruthField, TruthModel } from './truth/gitea.js';

export interface GradeInput {
  readonly model: SiteModel;
  readonly truth: TruthModel;
  /**
   * What capture saw. `endpoint-identity` recall is over this and never over the
   * whole spec: Gitea declares hundreds of endpoints and a crawl touches a few
   * dozen, so scoring against the document would measure the crawler's reach and
   * call it inference quality. Crawl coverage is reported beside it, as a
   * property of capture.
   */
  readonly observed: readonly ObservedEndpoint[];
  readonly divergence: readonly KnownDivergence[];
}

/**
 * A rate or a count, and the report says which.
 *
 * `auth.under-gate-count` is a count on purpose — "there is no rate here because
 * a rate invites trading a leak against volume" — so rendering it as a fraction
 * would be reporting the opposite of what §4 decided.
 */
export type MetricKind = 'rate' | 'count';

export interface MetricResult {
  readonly id: string;
  readonly category: GradeCategoryId;
  readonly kind: MetricKind;
  readonly numerator: number;
  readonly denominator: number;
  /** `null` when vacuous. Never 1.0 from an empty denominator. */
  readonly value: number | null;
  readonly vacuous: boolean;
  /** Which denominator was empty, in the contract's own words. */
  readonly emptyDenominator: string | null;
  readonly gate: GradeMetric['gate'];
  /** Vacuous fails. A metric with no gate passes by definition — reporting is not scoring. */
  readonly passed: boolean;
  /** Fields this category excluded on the known-divergence list. */
  readonly excluded: number;
}

export interface GradeReport {
  readonly metricsVersion: number;
  readonly contractDigest: string;
  readonly metrics: readonly MetricResult[];
  readonly matching: {
    readonly matched: number;
    readonly unmatchedOperations: number;
    readonly outOfUniverse: number;
    readonly ambiguous: readonly string[];
    readonly arityMismatches: number;
  };
  /**
   * A property of **capture**, reported beside the score and not gated. Two
   * numbers, two subjects.
   */
  readonly crawlCoverage: { readonly observed: number; readonly specTotal: number };
  readonly auth: {
    readonly observedRequired: number;
    readonly observedNotRequired: number;
    readonly indeterminate: number;
    readonly unobserved: number;
    /** Operations whose verdict cannot rest on a probe: a property of the API. */
    readonly unprobeable: number;
  };
  readonly divergence: DivergenceBudget;
  /** Categories whose truth side the loader does not derive. Vacuous, and named. */
  readonly notDerived: readonly GradeCategoryId[];
  /** Every gated metric passed and none was vacuous. */
  readonly passed: boolean;
  /** Categories that failed, so a failure reads as a list rather than a boolean. */
  readonly failedCategories: readonly GradeCategoryId[];
}

/**
 * Which metrics report a count. Closed, and a test asserts it names only real
 * metric ids — the freeze rule's whole-set form, so a metric renamed in the
 * contract cannot leave a stale entry here reading as a rate.
 */
const COUNT_METRICS: ReadonlySet<string> = new Set([
  'auth.under-gate-count',
  'auth.unprobeable-count',
]);

interface Tally {
  numerator: number;
  denominator: number;
  /** Set when the category cannot be scored at all, whatever the counts say. */
  ungrounded?: string;
  excluded?: number;
}

const ZERO: Tally = { numerator: 0, denominator: 0 };

// ---------------------------------------------------------------------------
// Field enumeration, per matched pair
// ---------------------------------------------------------------------------

/** A field claim on one side, keyed so the two sides can be intersected. */
interface FieldClaim {
  readonly key: string;
  readonly pointer: string;
}

const responseKey = (status: string | number, pointer: string): string => `${status} ${pointer}`;

function modelResponseFields(pair: MatchedPair): Map<string, JsonSchemaNode> {
  const out = new Map<string, JsonSchemaNode>();
  for (const response of pair.operation.responses) {
    for (const field of modelFieldPointers(response.schema)) {
      out.set(responseKey(response.status, field.pointer), field.node);
    }
  }
  return out;
}

function truthResponseFields(pair: MatchedPair): Map<string, TruthField> {
  const out = new Map<string, TruthField>();
  for (const field of pair.truth.responseFields) out.set(responseKey(field.status, field.pointer), field);
  return out;
}

function modelRequestFields(pair: MatchedPair): Map<string, JsonSchemaNode> {
  const out = new Map<string, JsonSchemaNode>();
  for (const field of modelFieldPointers(pair.operation.request)) out.set(field.pointer, field.node);
  return out;
}

function truthRequestFields(pair: MatchedPair): Map<string, TruthField> {
  const out = new Map<string, TruthField>();
  for (const field of pair.truth.requestFields) out.set(field.pointer, field);
  return out;
}

// ---------------------------------------------------------------------------
// Narrowing agreement, fixed here before any score existed
// ---------------------------------------------------------------------------

/**
 * What the model narrowed a field to, if anything.
 *
 * The schema guarantees a `narrowing` record accompanies any of these, so the
 * presence of the constraint is the presence of the claim.
 */
function modelNarrowing(node: JsonSchemaNode): 'enum' | 'const' | 'format' | null {
  if (node.enum !== undefined) return 'enum';
  if (node.const !== undefined) return 'const';
  if (node.format !== undefined) return 'format';
  return null;
}

/**
 * What the spec narrowed a field to, **in the vocabulary the model can speak**.
 *
 * Measured on first contact, and it is the auth finding again in a smaller key:
 * of the 5 508 formats Gitea's document declares, 3 380 are `int64`/`uint64` —
 * integer width annotations, which `JsonStringFormatSchema` is string-only and
 * therefore cannot express at all. Counting those as narrowings infer missed
 * would score the gap between two vocabularies and report it as inference
 * quality; on the baseline slice it accounted for 22 of 40 supposed recall
 * misses, none of which any model could ever have hit.
 *
 * Restricting the truth side to expressible claims is a definition, not a
 * threshold: nothing in the contract's table moves and the digest does not
 * change. Written down here and in decision 0018 because it was settled by a
 * measurement rather than argued after seeing a score — the distinction 0015 §5
 * insists on, and the reason it is recorded rather than quietly applied.
 */
const truthNarrowing = (field: TruthField): 'enum' | 'format' | null =>
  field.enumValues !== null
    ? 'enum'
    : field.format !== null && isExpressibleFormat(field.format)
      ? 'format'
      : null;

/**
 * Does the spec agree with the narrowing the model made?
 *
 * **Spec values ⊆ model values**, not equality and not the reverse. §13's
 * argument decides the direction: a wrong enum makes valid states of the real
 * system unrepresentable in the clone, so an enum that *omits* a value the spec
 * allows is the failure this category exists to catch. One that carries an extra
 * value the spec does not list is over-permissive — the cheap direction, and
 * indistinguishable from a spec that is merely behind its server.
 *
 * A `const` is an enum of one and is held to the same rule, which for a single
 * value collapses to equality.
 *
 * Written down here, and in the decision note, before the first score. The
 * contract's prose does not settle it, so it is recorded rather than argued
 * afterwards — and it is not a threshold, so the digest does not move.
 */
function narrowingAgrees(node: JsonSchemaNode, field: TruthField): boolean {
  const kind = modelNarrowing(node);
  if (kind === 'format') return field.format !== null && field.format === node.format;
  if (field.enumValues === null) return false;
  const model = new Set(
    (kind === 'enum' ? (node.enum ?? []) : [node.const]).map((v) => String(v)),
  );
  return field.enumValues.every((v) => model.has(v));
}

// ---------------------------------------------------------------------------
// The categories
// ---------------------------------------------------------------------------

function endpointIdentity(matching: Matching): { precision: Tally; recall: Tally } {
  const emitted = matching.pairs.length + matching.unmatchedOperations.length;
  return {
    precision: { numerator: matching.pairs.length, denominator: emitted },
    recall: { numerator: matching.observedEmitted, denominator: matching.observedInUniverse },
  };
}

function pathParams(matching: Matching): { arity: Tally; naming: Tally } {
  // Shape matching already folds arity into identity, so every matched pair
  // agrees on it by construction. The denominator is therefore the pairs that
  // agree *plus* the endpoints that found the right resource with the wrong
  // number of holes — otherwise this category reports 1.0 forever and moves for
  // nothing, which is a vacuous check with a number on it.
  const arity = {
    numerator: matching.pairs.length,
    denominator: matching.pairs.length + matching.arityMismatches.length,
  };
  let named = 0;
  let total = 0;
  for (const pair of matching.pairs) {
    const declared = pair.operation.pathParams.map((p) => p.name);
    for (const [i, expected] of pair.truth.paramNames.entries()) {
      total += 1;
      if (declared[i] === expected) named += 1;
    }
  }
  return { arity, naming: { numerator: named, denominator: total } };
}

interface FieldTallies {
  requestPrecision: Tally;
  requestRecall: Tally;
  responsePrecision: Tally;
  responseRecall: Tally;
  fieldType: Tally;
  narrowingPrecision: Tally;
  narrowingRecall: Tally;
}

function fieldCategories(pairs: readonly MatchedPair[]): FieldTallies {
  const t: FieldTallies = {
    requestPrecision: { numerator: 0, denominator: 0 },
    requestRecall: { numerator: 0, denominator: 0 },
    responsePrecision: { numerator: 0, denominator: 0 },
    responseRecall: { numerator: 0, denominator: 0 },
    fieldType: { numerator: 0, denominator: 0 },
    narrowingPrecision: { numerator: 0, denominator: 0 },
    narrowingRecall: { numerator: 0, denominator: 0 },
  };

  const score = (
    model: Map<string, JsonSchemaNode>,
    truth: Map<string, TruthField>,
    precision: Tally,
    recall: Tally,
  ): void => {
    precision.denominator += model.size;
    recall.denominator += truth.size;
    for (const [key, node] of model) {
      const counterpart = truth.get(key);
      if (counterpart === undefined) continue;
      precision.numerator += 1;
      recall.numerator += 1;

      // Type and narrowing are scored over *matched* fields — a pointer present
      // on both sides. A field the model invented has no spec type to disagree
      // with, and charging it here would count one mistake twice.
      t.fieldType.denominator += 1;
      if (typeAgrees(node, counterpart)) t.fieldType.numerator += 1;

      if (modelNarrowing(node) !== null) {
        t.narrowingPrecision.denominator += 1;
        if (narrowingAgrees(node, counterpart)) t.narrowingPrecision.numerator += 1;
      }
      if (truthNarrowing(counterpart) !== null) {
        t.narrowingRecall.denominator += 1;
        if (modelNarrowing(node) !== null && narrowingAgrees(node, counterpart)) {
          t.narrowingRecall.numerator += 1;
        }
      }
    }
  };

  for (const pair of pairs) {
    score(modelRequestFields(pair), truthRequestFields(pair), t.requestPrecision, t.requestRecall);
    score(
      modelResponseFields(pair),
      truthResponseFields(pair),
      t.responsePrecision,
      t.responseRecall,
    );
  }
  return t;
}

function synthesized(matching: Matching): Tally {
  const isSynthesized = (pair: { operation: { discovery: { kind: string } } }): boolean =>
    pair.operation.discovery.kind === 'bound-from-control';
  const matched = matching.pairs.filter(isSynthesized).length;
  const missed = matching.unmatchedOperations.filter(
    (o) => o.discovery.kind === 'bound-from-control',
  ).length;
  return { numerator: matched, denominator: matched + missed };
}

interface AuthTallies {
  underGate: Tally;
  overGate: Tally;
  truthCoverage: Tally;
  evidenceCoverage: Tally;
  unprobeable: Tally;
  observedRequired: number;
  observedNotRequired: number;
  indeterminate: number;
  unobserved: number;
}

/**
 * Can this operation's auth verdict rest on a recorded probe?
 *
 * Only a GET capture actually issued. §6 re-issues "each distinct **GET**
 * endpoint once anonymously" and never a mutation — "issuing a PATCH or DELETE
 * without a session to find out what happens changes the target's state, which
 * capture must not do". And §7.6's `bound-from-control` endpoints were never
 * fired at all, so there was nothing to re-issue.
 *
 * This is why evidence coverage is split rather than relaxed: averaging the two
 * populations bounds the metric below 1 for a reason that is a property of the
 * API's read/write ratio, not of inference quality.
 */
const isProbeableRead = (operation: MatchedPair['operation']): boolean =>
  operation.method === 'GET' && operation.discovery.kind === 'observed';

function auth(pairs: readonly MatchedPair[]): AuthTallies {
  const t: AuthTallies = {
    underGate: { numerator: 0, denominator: 0 },
    overGate: { numerator: 0, denominator: 0 },
    truthCoverage: { numerator: 0, denominator: pairs.length },
    evidenceCoverage: { numerator: 0, denominator: 0 },
    // Denominator is the graded population, not the count itself: zero
    // unprobeable operations is a real and good outcome (an all-GET surface),
    // and a 0/0 here would read vacuous and fail a metric that is reported only.
    unprobeable: { numerator: 0, denominator: pairs.length },
    observedRequired: 0,
    observedNotRequired: 0,
    indeterminate: 0,
    unobserved: 0,
  };
  for (const pair of pairs) {
    // §8: "never read the field as a boolean". `resolveAuthForCodegen` is what
    // decides whether the clone gates this endpoint, and grading anything else
    // would score a model the clone does not build. Reading
    // `requiresAuth === 'required'` here would silently reclassify every
    // `unknown` as open and turn the evidence-coverage row of the mutation table
    // into a second under-gate row.
    const gated = resolveAuthForCodegen(pair.operation.requiresAuth);
    if (isProbeableRead(pair.operation)) {
      t.evidenceCoverage.denominator += 1;
      if (pair.operation.requiresAuth !== 'unknown') t.evidenceCoverage.numerator += 1;
    } else {
      // Counted, never rated. A denominator here would re-merge the two
      // populations the split exists to keep apart.
      t.unprobeable.numerator += 1;
    }

    switch (pair.truth.auth) {
      case 'required':
        t.observedRequired += 1;
        t.truthCoverage.numerator += 1;
        t.underGate.denominator += 1;
        if (!gated) t.underGate.numerator += 1;
        break;
      case 'not-required':
        t.observedNotRequired += 1;
        t.truthCoverage.numerator += 1;
        t.overGate.denominator += 1;
        if (gated) t.overGate.numerator += 1;
        break;
      case 'indeterminate':
        // Excluded from the category and counted, never silently defaulted.
        t.indeterminate += 1;
        break;
      default:
        t.unobserved += 1;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------

/** Endpoints the known-divergence list removes from one category. */
function exclusions(entries: readonly KnownDivergence[]): Map<GradeCategoryId, Set<string>> {
  const out = new Map<GradeCategoryId, Set<string>>();
  for (const entry of entries) {
    const set = out.get(entry.category) ?? new Set<string>();
    set.add(`${entry.method.toUpperCase()} ${entry.specPath}`);
    out.set(entry.category, set);
  }
  return out;
}

export function gradeSiteModel(input: GradeInput): GradeReport {
  const { model, truth, observed, divergence } = input;
  const excluded = exclusions(divergence);
  const notDerived = new Set(truth.notDerived);

  const all = matchEndpoints(model.operations, truth, observed);
  /** The pairs a category scores over, after its own exclusions. */
  const pairsFor = (category: GradeCategoryId): MatchedPair[] => {
    const skip = excluded.get(category);
    if (skip === undefined) return [...all.pairs];
    return all.pairs.filter((p) => !skip.has(`${p.truth.method} ${p.truth.specPath}`));
  };
  const excludedCount = (category: GradeCategoryId): number =>
    all.pairs.length - pairsFor(category).length;

  const identity = endpointIdentity({ ...all, pairs: pairsFor('endpoint-identity') });
  const params = pathParams({ ...all, pairs: pairsFor('path-param-arity') });
  const naming = pathParams({ ...all, pairs: pairsFor('path-param-naming') }).naming;
  const fields = fieldCategories(pairsFor('field-type'));
  const requestFields = fieldCategories(pairsFor('request-field-presence'));
  const responseFields = fieldCategories(pairsFor('response-field-presence'));
  const narrowings = fieldCategories(pairsFor('narrowing'));
  const authTallies = auth(pairsFor('auth'));

  const ungroundedIdentifier =
    'foreign keys derivable from the spec — this truth side is not derived (0015 modality table)';
  const byMetric: Record<string, Tally> = {
    'endpoint-identity.precision': identity.precision,
    'endpoint-identity.recall': identity.recall,
    'path-param-arity.accuracy': params.arity,
    'path-param-naming.accuracy': naming,
    'request-field-presence.precision': requestFields.requestPrecision,
    'request-field-presence.recall': requestFields.requestRecall,
    'response-field-presence.precision': responseFields.responsePrecision,
    'response-field-presence.recall': responseFields.responseRecall,
    'field-type.accuracy': fields.fieldType,
    'narrowing.precision': narrowings.narrowingPrecision,
    'narrowing.recall': narrowings.narrowingRecall,
    'identifier.precision': { ...ZERO, ungrounded: ungroundedIdentifier },
    'identifier.recall': { ...ZERO, ungrounded: ungroundedIdentifier },
    'synthesized-endpoint.precision': synthesized({ ...all, pairs: pairsFor('synthesized-endpoint') }),
    'auth.under-gate-count': authTallies.underGate,
    'auth.over-gate-rate': authTallies.overGate,
    'auth.truth-coverage': authTallies.truthCoverage,
    'auth.evidence-coverage': authTallies.evidenceCoverage,
    'auth.unprobeable-count': authTallies.unprobeable,
  };

  /**
   * A truth with nothing in this universe ungrounds **every** category, not
   * only the ones that consult it.
   *
   * Found by the `truth-emptied` mutation on the harness's first run, which is
   * the whole reason that row exists. `endpoint-identity.recall` is computed
   * against the *observed* list and never reads the truth at all, so it happily
   * reported 1.000 inside a report whose truth side was empty — the exact shape
   * §6 exists to forbid, arrived at from a direction the vacuity rule as
   * written could not see. Precision and the synthesized-endpoint rate had the
   * mirror problem: a real 0.000, which reads as a terrible model rather than
   * as no ground truth.
   *
   * The loader's floors are the first layer and they stop this today. This is
   * the second, and it reports a bug in the first — the same arrangement as the
   * post-click origin check behind the router chokepoint.
   */
  const emptyTruth =
    all.truthInUniverse === 0
      ? `the ground truth has no endpoints under ${truth.basePath}; §6 — a grader whose truth did not load reports nothing`
      : undefined;

  const metrics: MetricResult[] = GRADE_METRICS.map((metric) => {
    const tally = byMetric[metric.id] ?? ZERO;
    const ungrounded =
      emptyTruth ?? (notDerived.has(metric.category) ? ungroundedIdentifier : tally.ungrounded);
    const kind: MetricKind = COUNT_METRICS.has(metric.id) ? 'count' : 'rate';
    const vacuous = ungrounded !== undefined || tally.denominator === 0;
    const value = vacuous
      ? null
      : kind === 'count'
        ? tally.numerator
        : tally.numerator / tally.denominator;
    const passed =
      !vacuous &&
      (metric.gate === null ||
        (metric.gate.direction === 'atLeast'
          ? (value ?? 0) >= metric.gate.value
          : (value ?? 0) <= metric.gate.value));
    return {
      id: metric.id,
      category: metric.category,
      kind,
      numerator: tally.numerator,
      denominator: tally.denominator,
      value,
      vacuous,
      emptyDenominator: vacuous ? (ungrounded ?? metric.denominator) : null,
      gate: metric.gate,
      passed,
      excluded: excludedCount(metric.category),
    };
  });

  const failedCategories = GRADE_CATEGORIES.filter((category) =>
    metrics.some((m) => m.category === category && !m.passed),
  );

  return {
    metricsVersion: METRICS_VERSION,
    contractDigest: GRADE_CONTRACT_DIGEST,
    metrics,
    matching: {
      matched: all.pairs.length,
      unmatchedOperations: all.unmatchedOperations.length,
      outOfUniverse: all.outOfUniverse.length,
      ambiguous: all.ambiguous,
      arityMismatches: all.arityMismatches.length,
    },
    crawlCoverage: { observed: all.observedInUniverse, specTotal: all.truthInUniverse },
    auth: {
      observedRequired: authTallies.observedRequired,
      observedNotRequired: authTallies.observedNotRequired,
      indeterminate: authTallies.indeterminate,
      unobserved: authTallies.unobserved,
      unprobeable: authTallies.unprobeable.numerator,
    },
    divergence: assessDivergenceBudget(divergence, all.pairs.length),
    notDerived: truth.notDerived,
    passed: failedCategories.length === 0,
    failedCategories,
  };
}
