/**
 * The scored-field contract — what grading infer measures, frozen before the
 * model it constrains exists.
 *
 * Decision 0015. Two properties make this file what it is, and neither is about
 * its contents:
 *
 * 1. **It is committed before `site-model.ts` stops being a placeholder.** The
 *    list's value is as a second backward-derivation force on SiteModel,
 *    alongside §5's "what codegen consumes". A list written after the model, or
 *    bent to fit it, is derived *from* the model and derives nothing. If a
 *    scored field turns out awkward to represent, SiteModel changes.
 * 2. **It imports nothing from the model layer, and a test says so.** An import
 *    is how "independent" quietly stops being true.
 *
 * It lives in `packages/schema` rather than in `packages/verify` beside the
 * grader for one concrete reason: §7.1 requires infer's first stage report to
 * carry the category list, and turn 2's ruling on `manifest.counts.gaps` says a
 * derived value must not be duplicated across two artifacts — one side computes
 * it, the other references it. The recompute needs both in one place.
 *
 * `GRADE_CONTRACT_DIGEST` is the freeze. Changing a threshold means changing the
 * digest in the same commit, which is a diff a reviewer sees. It is not
 * tamper-proof and is not meant to be; it is un-quiet.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Bumped when the shape of the contract changes, not when a number moves. */
export const METRICS_VERSION = 1;

/**
 * The scored categories (0015 §3).
 *
 * Per-category and never blended into one number — §13: an aggregate lets a
 * partial loss hide inside a surviving total. There is no overall score, and
 * the gate is a conjunction.
 */
export const GradeCategoryIdSchema = z.enum([
  'endpoint-identity',
  'path-param-arity',
  'path-param-naming',
  'request-field-presence',
  'response-field-presence',
  'field-type',
  'narrowing',
  'identifier',
  'synthesized-endpoint',
  'auth',
]);
export type GradeCategoryId = z.infer<typeof GradeCategoryIdSchema>;

/**
 * A threshold is one of two things, and the difference is not cosmetic.
 *
 * `calibration` — a number nobody has measured yet. Provisional until the first
 * Gitea run; changing it needs a decision note recording the distribution that
 * justified it.
 *
 * `structural` — a number that follows from an argument about which failures are
 * visible. Changing it means overturning the argument, not producing a
 * measurement. Narrowing precision is near-1 because a wrong enum is silent
 * corruption of the mock's data model; the auth under-gate count is zero because
 * that failure is invisible in the trajectory.
 */
export type ThresholdKind = 'structural' | 'calibration';

export interface GradeMetric {
  /** `<category>.<metric>` — stable, and what the report keys on. */
  readonly id: string;
  readonly category: GradeCategoryId;
  /** What is counted. */
  readonly numerator: string;
  /**
   * The denominator, in words.
   *
   * Named rather than implied, because 0015 §4's three auth numbers are over
   * three different denominators and written as three bare rates the next
   * reader averages them. The prose is the contract; the grader's code has to
   * match it, not the other way round.
   */
  readonly denominator: string;
  /** `null` means reported and not gated. Reporting is not scoring. */
  readonly gate:
    | { readonly kind: ThresholdKind; readonly direction: 'atLeast' | 'atMost'; readonly value: number }
    | null;
  readonly why?: string;
}

const atLeast = (value: number, kind: ThresholdKind) => ({ kind, direction: 'atLeast' as const, value });
const atMost = (value: number, kind: ThresholdKind) => ({ kind, direction: 'atMost' as const, value });

/**
 * The table. Order is part of the contract — §7.1's stage report reproduces it.
 */
export const GRADE_METRICS: readonly GradeMetric[] = [
  {
    id: 'endpoint-identity.precision',
    category: 'endpoint-identity',
    numerator: 'emitted endpoints matching a spec endpoint on (method, positional path shape)',
    denominator: 'endpoints infer emitted, in-universe',
    gate: atLeast(0.95, 'calibration'),
    why: 'the hallucination measure, and §7 calls hallucination the cardinal sin',
  },
  {
    id: 'endpoint-identity.recall',
    category: 'endpoint-identity',
    numerator: 'capture-observed endpoints infer emitted',
    denominator: 'endpoints CAPTURE OBSERVED, in-universe — never the whole spec',
    gate: atLeast(0.9, 'calibration'),
    why: 'recall against the whole spec measures the crawler’s reach and calls it inference quality; crawl coverage is reported separately as a property of capture',
  },
  {
    id: 'path-param-arity.accuracy',
    category: 'path-param-arity',
    numerator: 'matched endpoints whose parameter count equals the spec’s',
    denominator: 'matched endpoints',
    gate: atLeast(0.95, 'calibration'),
  },
  {
    id: 'path-param-naming.accuracy',
    category: 'path-param-naming',
    numerator: 'matched parameters whose name equals the spec’s',
    denominator: 'matched parameters',
    gate: null,
    why: 'capture infers a name from observed values and cannot know the spec calls it `owner`; folding naming into identity would hide real misses behind cosmetic ones',
  },
  {
    id: 'request-field-presence.precision',
    category: 'request-field-presence',
    numerator: 'emitted request fields the spec declares',
    denominator: 'request fields infer emitted, on matched endpoints',
    gate: atLeast(0.95, 'calibration'),
  },
  {
    id: 'request-field-presence.recall',
    category: 'request-field-presence',
    numerator: 'spec request fields infer emitted',
    denominator: 'request fields the spec declares, on matched endpoints',
    gate: atLeast(0.9, 'calibration'),
  },
  {
    id: 'response-field-presence.precision',
    category: 'response-field-presence',
    numerator: 'emitted (status, pointer) response fields the spec declares',
    denominator: 'response fields infer emitted, on matched endpoints',
    gate: atLeast(0.95, 'calibration'),
  },
  {
    id: 'response-field-presence.recall',
    category: 'response-field-presence',
    numerator: 'spec (status, pointer) response fields infer emitted',
    denominator: 'response fields the spec declares, on matched endpoints',
    gate: atLeast(0.9, 'calibration'),
  },
  {
    id: 'field-type.accuracy',
    category: 'field-type',
    numerator: 'matched fields whose JSON type equals the spec’s, under the two fixed normalisations',
    denominator: 'matched fields the spec types',
    gate: atLeast(0.9, 'calibration'),
    why: '`integer` counts as `number`; a nullable type matches its non-nullable counterpart where the spec marks the field optional. Fixed in advance so they cannot be argued after seeing a score',
  },
  {
    id: 'narrowing.precision',
    category: 'narrowing',
    numerator: 'emitted narrowings the spec agrees with',
    denominator: 'narrowings infer emitted',
    gate: atLeast(0.98, 'structural'),
    why: '§13: narrowing must be justified, widening is free. A wrong enum makes valid states of the real system unrepresentable in the clone and corrupts every trajectory through the field',
  },
  {
    id: 'narrowing.recall',
    category: 'narrowing',
    numerator: 'spec narrowings infer emitted',
    denominator: 'narrowings the spec declares, on matched fields',
    gate: null,
    why: 'a missed enum costs an over-permissive mock, which is the cheap direction',
  },
  {
    id: 'identifier.precision',
    category: 'identifier',
    numerator: 'emitted `identifier.pathParamOf` claims the spec corroborates',
    denominator: 'identifiers infer emitted',
    gate: atLeast(0.9, 'calibration'),
  },
  {
    id: 'identifier.recall',
    category: 'identifier',
    numerator: 'spec-derivable foreign keys infer emitted',
    denominator: 'foreign keys derivable from the spec, on matched endpoints',
    gate: atLeast(0.8, 'calibration'),
  },
  {
    id: 'synthesized-endpoint.precision',
    category: 'synthesized-endpoint',
    numerator: '`discovery: bound-from-control` endpoints the spec declares',
    denominator: 'synthesized endpoints infer emitted',
    gate: atLeast(0.9, 'structural'),
    why: '§7.6 binds a URL read out of a form action for a control capture never fired — the highest-hallucination-risk claim in the model. Recall is meaningless: not binding a control is a gap, which is the correct outcome',
  },
  {
    id: 'auth.under-gate-count',
    category: 'auth',
    numerator: 'endpoints infer leaves open where the truth is `required`',
    denominator: 'endpoints where the truth sweep OBSERVED required — never the whole surface',
    gate: atMost(0, 'structural'),
    why: 'the invisible failure: every §10 auth task reading through it is bypassable and the trajectory reads as success. A count and not a rate, because a rate invites trading a leak against volume',
  },
  {
    id: 'auth.over-gate-rate',
    category: 'auth',
    numerator: 'endpoints infer gates where the truth is `not-required`',
    denominator: 'endpoints where the truth sweep OBSERVED not-required — never the whole surface',
    gate: atMost(0.2, 'calibration'),
    why: 'the visible, cheap failure — one login step, and failing closed on a genuinely unknown endpoint is correct behaviour rather than an error',
  },
  {
    id: 'auth.truth-coverage',
    category: 'auth',
    numerator: 'graded endpoints the truth sweep observed anonymously',
    denominator: 'ALL GRADED endpoints',
    gate: null,
    why: 'the two metrics above are over what the sweep observed, and on the pinned Gitea that is 50 of 482 operations. Reported as a number rather than a footnote: an under-gate count of zero over 37 endpoints is not the same claim as one over 482, and without this the report cannot tell them apart',
  },
  {
    id: 'auth.evidence-coverage',
    category: 'auth',
    numerator: 'endpoints resolved from recorded evidence rather than the fail-closed default',
    denominator: 'ALL GRADED endpoints — this one needs no truth side, only the model',
    gate: atLeast(0.7, 'calibration'),
    why: 'what stops the degenerate model scoring well: gating everything gives an under-gate count of zero and evidence coverage near zero. Computable from the model alone — whether a verdict rests on a recorded observation is a property of the verdict — so unlike the two above it is genuinely over the whole graded universe',
  },
];

/** Every category, in table order. */
export const GRADE_CATEGORIES: readonly GradeCategoryId[] = [
  ...new Set(GRADE_METRICS.map((m) => m.category)),
];

/**
 * The digest of the frozen table.
 *
 * Canonicalised over the fields that decide what is measured — ids, categories,
 * denominators and gates. Prose in `why` is excluded on purpose: an explanation
 * improving should not look like a metric changing, and a metric changing must
 * not be able to hide behind an explanation improving.
 */
export function computeGradeContractDigest(): string {
  const canonical = JSON.stringify({
    metricsVersion: METRICS_VERSION,
    categories: GRADE_CATEGORIES,
    metrics: GRADE_METRICS.map((m) => [m.id, m.category, m.numerator, m.denominator, m.gate]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Committed constant. A test asserts it equals `computeGradeContractDigest()`,
 * so moving a threshold without updating this line fails the suite.
 */
export const GRADE_CONTRACT_DIGEST =
  '532912767657984fdf6197f0e5e0f305b8f2ec973182c566316574d6e8d1957f';

// ---------------------------------------------------------------------------
// Known divergence (0015 §1)
// ---------------------------------------------------------------------------

/**
 * One excluded field, with the evidence that the **spec** — not infer — is
 * wrong.
 *
 * Same shape as `NarrowingRecord`: the justification travels with the exclusion,
 * and an entry without evidence does not parse.
 */
export const KnownDivergenceSchema = z.strictObject({
  /** Which scored category this exclusion removes a field from. */
  category: GradeCategoryIdSchema,
  /** Spec-relative path, as written in the document. */
  specPath: z.string().min(1),
  method: z.string().min(1).toUpperCase(),
  /** The claim the spec makes. */
  specSays: z.string().min(1),
  /** What the server actually does. */
  serverDoes: z.string().min(1),
  /** The recorded exchange proving it. A belief is not evidence. */
  evidence: z.strictObject({
    request: z.string().min(1),
    responseStatus: z.int(),
    responseExcerpt: z.string().min(1),
    observedAt: z.string().min(1),
  }),
});
export type KnownDivergence = z.infer<typeof KnownDivergenceSchema>;

/** Of the graded endpoints, the share the whole list may exclude. */
export const DIVERGENCE_CAP = 0.05;
/**
 * And the share any single category may take of that cap.
 *
 * The global cap cannot see the shape that matters: 5% spent entirely on
 * `narrowing` reads identically to 5% spread across ten categories, and only one
 * of those is a stale spec. A document drifts in ways uncorrelated with which
 * claims infer finds hard, so a list piling up where infer is weakest is
 * describing infer, one individually-justified entry at a time.
 */
export const DIVERGENCE_CATEGORY_SHARE = 0.5;

export interface DivergenceBudget {
  readonly gradedEndpoints: number;
  readonly total: number;
  readonly cap: number;
  readonly categoryCap: number;
  readonly perCategory: ReadonlyArray<{ category: GradeCategoryId; count: number }>;
  /** Over the global cap: the ground truth is not fit for grading. */
  readonly overCap: boolean;
  /** Over half the cap in one category: re-examine before another entry lands there. */
  readonly concentrated: readonly GradeCategoryId[];
  readonly messages: readonly string[];
}

export function assessDivergenceBudget(
  entries: readonly KnownDivergence[],
  gradedEndpoints: number,
): DivergenceBudget {
  const cap = gradedEndpoints * DIVERGENCE_CAP;
  const categoryCap = cap * DIVERGENCE_CATEGORY_SHARE;
  const counts = new Map<GradeCategoryId, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  const perCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const concentrated = perCategory.filter((c) => c.count > categoryCap).map((c) => c.category);
  const overCap = entries.length > cap;
  const messages: string[] = [];
  if (overCap) {
    messages.push(
      `known divergence covers ${entries.length} of ${gradedEndpoints} graded endpoints, over the ${(DIVERGENCE_CAP * 100).toFixed(0)}% cap. Past that the ground truth is not fit for grading and the problem is the target, not the threshold.`,
    );
  }
  for (const category of concentrated) {
    const count = counts.get(category) ?? 0;
    messages.push(
      `known divergence is concentrated in ${category}: ${count} entries against a per-category budget of ${categoryCap.toFixed(1)}. A spec stale in one direction is plausible; a spec stale exactly where infer is weakest is the shape this cap exists to catch. Re-examine before another entry lands there.`,
    );
  }
  return { gradedEndpoints, total: entries.length, cap, categoryCap, perCategory, overCap, concentrated, messages };
}

// ---------------------------------------------------------------------------
// What infer's stage report carries (0015 §7.1)
// ---------------------------------------------------------------------------

/**
 * The contract, reported **before any score exists**.
 *
 * A category list that first becomes visible attached to a score gets read as a
 * score, and a category quietly absent from the table is invisible in exactly
 * the case that matters. So infer's first stage report says what is measured,
 * and the grader later says how it did.
 *
 * A reference, not a copy: `categories` is recomputed against `GRADE_CATEGORIES`
 * here, so a report naming a category the contract does not have — or missing
 * one it does, or listing them in another order — does not parse.
 */
export const InferMetricsBlockSchema = z
  .strictObject({
    metricsVersion: z.literal(METRICS_VERSION),
    contractDigest: z.literal(GRADE_CONTRACT_DIGEST),
    categories: z.array(GradeCategoryIdSchema),
    metricIds: z.array(z.string().min(1)),
    /**
     * Present once a grade has run. Absent in the first report, which is the
     * point of §7.1 — and absent is not zero, so nothing here can be mistaken
     * for a score of nothing.
     */
    graded: z.boolean(),
  })
  .superRefine((block, ctx) => {
    const expected = GRADE_CATEGORIES;
    if (block.categories.length !== expected.length || block.categories.some((c, i) => c !== expected[i])) {
      ctx.addIssue({
        code: 'custom',
        path: ['categories'],
        message: `the scored categories are derived from the contract, not restated: expected [${expected.join(', ')}]`,
      });
    }
    const expectedIds = GRADE_METRICS.map((m) => m.id);
    if (block.metricIds.length !== expectedIds.length || block.metricIds.some((m, i) => m !== expectedIds[i])) {
      ctx.addIssue({
        code: 'custom',
        path: ['metricIds'],
        message: `the metric ids are derived from the contract, not restated: expected ${expectedIds.length} in table order`,
      });
    }
  });
export type InferMetricsBlock = z.infer<typeof InferMetricsBlockSchema>;

/** The block, built from the contract. Callers reference; they do not restate. */
export function inferMetricsBlock(options: { graded: boolean }): InferMetricsBlock {
  return {
    metricsVersion: METRICS_VERSION,
    contractDigest: GRADE_CONTRACT_DIGEST,
    categories: [...GRADE_CATEGORIES],
    metricIds: GRADE_METRICS.map((m) => m.id),
    graded: options.graded,
  };
}
