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

/**
 * Bumped when the shape of the contract changes, not when a number moves.
 *
 * v2 (decision 0018 §5): `auth.evidence-coverage` was averaging two populations
 * with different achievable ceilings, and the fix splits it rather than
 * relaxing it. A new metric is a shape change, not a number moving.
 *
 * v3 (decision 0022): every category here scores a **capture** artifact, so
 * they are grouped into a named `suite` that says so, and
 * `endpoint-identity.recall` is renamed to `.conservation` because it is not a
 * recall metric. Both are shape changes; neither is a number being tuned.
 *
 * v4 (decision 0023): the `inference` suite — four categories over
 * `model.entities`, which no metric read at all. 0021 measured that every
 * `capture-fidelity` category is blind to every piece of infer; this is the
 * half that moves.
 *
 * v5 (decision 0048): `response-field-presence` splits. 0046 measured that its
 * two halves have different subjects — precision is one endpoint's map-valued
 * response modelled as a record type, an inference defect that a richer seed
 * makes *worse*; recall is bounded above by seed coverage, 62 of its 208
 * misses coming from five endpoints the seed never populates. Averaging two
 * populations with different achievable ceilings is exactly what v2 split
 * `auth.evidence-coverage` for, and the remedy is the same shape: score each
 * over the population it is about, and report the ceiling itself as a third
 * number rather than letting it bound a metric silently.
 *
 * A pair whose halves can move for unrelated reasons is two metrics.
 */
export const METRICS_VERSION = 5;

/**
 * Which set a metric belongs to — and therefore what it is evidence *about*.
 *
 * 0015 built its categories to measure infer and named them accordingly. 0021
 * measured otherwise: the same capture was inferred with each of infer's pieces
 * disabled and graded each time, and **no category moved for any of them**.
 * Every metric reads `model.operations`, which infer transcribes from
 * `capture/network/endpoints.json` — response schemas, field types, path
 * parameters and the auth verdict are all produced by capture's
 * `inferEndpoints`. Twelve numbers badged as stage 2's were largely stage 1's.
 *
 * That is a labelling defect, not a misplaced stage: §5 puts response schemas in
 * the capture artifact and §6's "deterministic, no LLM" does not exclude them,
 * because a schema union over observed bodies is deterministic. Nothing moves;
 * the name does. `capture-fidelity` belongs to M1's continued-correctness gates.
 *
 * A suite is part of the contract and part of the digest. A metric moving
 * between suites changes what a number is a claim about, which is exactly the
 * kind of quiet change the digest exists to catch.
 */
export const GradeSuiteIdSchema = z.enum(['capture-fidelity', 'inference']);
export type GradeSuiteId = z.infer<typeof GradeSuiteIdSchema>;

/**
 * The scored categories (0015 §3).
 *
 * Per-category and never blended into one number — §13: an aggregate lets a
 * partial loss hide inside a surviving total. There is no overall score, and
 * the gate is a conjunction.
 */
export const GradeCategoryIdSchema = z.enum([
  // capture-fidelity, in table order (0022)
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
  // inference, in table order (0023)
  'entity-identity',
  'entity-field-presence',
  'entity-relation',
  'entity-narrowing',
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
  /** Which set this belongs to, and so what stage the number is about. */
  readonly suite: GradeSuiteId;
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
  /**
   * Set where the metric is a **conservation check** rather than a measurement:
   * a number that cannot fall except by one specific defect.
   *
   * A rate that is 1.000 for structural reasons reads as evidence and is not
   * one, and printing it beside a real measurement invites exactly that reading.
   * The string names what *does* move it, so the claim stays falsifiable — and
   * the mutation row that exercises it stays meaningful instead of reading as a
   * metric nobody can fail.
   */
  readonly conservation?: string;
}

const atLeast = (value: number, kind: ThresholdKind) => ({ kind, direction: 'atLeast' as const, value });
const atMost = (value: number, kind: ThresholdKind) => ({ kind, direction: 'atMost' as const, value });

/**
 * The table. Order is part of the contract — §7.1's stage report reproduces it.
 */
export const GRADE_METRICS: readonly GradeMetric[] = [
  {
    id: 'endpoint-identity.precision',
    suite: 'capture-fidelity',
    category: 'endpoint-identity',
    numerator: 'emitted endpoints matching a spec endpoint on (method, positional path shape)',
    denominator: 'endpoints infer emitted, in-universe',
    gate: atLeast(0.95, 'calibration'),
    why: 'the hallucination measure, and §7 calls hallucination the cardinal sin',
  },
  {
    /**
     * Named `conservation`, not `recall`, because it is not a recall metric.
     *
     * `observedEmitted` counts observed endpoints whose `(method, pathShape)`
     * key the model emitted; `observed` is `capture/network/endpoints.json`; and
     * `model.operations` is a total `.map` over that same list with no filter.
     * So it reads 1.000 for any stage that transcribes the endpoint index, and
     * **no defect in inference can move it.** 0021 printed it beside
     * `path-param-naming` as though both were measurements.
     *
     * It is kept because the failure it would catch is real — a stage that
     * *drops* an endpoint — and it is gated at 1.0 rather than 0.9 for the same
     * reason: 0.9 permitted silently losing a tenth of the observed surface, and
     * there is no rate of endpoint loss that is acceptable. §7 wants a gap, not
     * a quiet omission. That makes the threshold `structural`: it follows from
     * the argument rather than from a distribution, so changing it means
     * overturning the argument.
     */
    id: 'endpoint-identity.conservation',
    suite: 'capture-fidelity',
    category: 'endpoint-identity',
    numerator: 'capture-observed endpoints the model still carries',
    denominator: 'endpoints CAPTURE OBSERVED, in-universe — never the whole spec',
    gate: atLeast(1, 'structural'),
    conservation:
      'moves only when a stage drops an observed endpoint. Both sides come from the observed list, so a transcription always reads 1.000 — this is not evidence that endpoint identity was inferred well. Exercised by the `endpoint-deleted` mutation.',
    why: 'recall against the whole spec would measure the crawler’s reach and call it inference quality; crawl coverage is reported separately as a property of capture',
  },
  {
    id: 'path-param-arity.accuracy',
    suite: 'capture-fidelity',
    category: 'path-param-arity',
    numerator: 'matched endpoints whose parameter count equals the spec’s',
    denominator: 'matched endpoints',
    gate: atLeast(0.95, 'calibration'),
  },
  {
    id: 'path-param-naming.accuracy',
    suite: 'capture-fidelity',
    category: 'path-param-naming',
    numerator: 'matched parameters whose name equals the spec’s',
    denominator: 'matched parameters',
    gate: null,
    why: 'capture infers a name from observed values and cannot know the spec calls it `owner`; folding naming into identity would hide real misses behind cosmetic ones',
  },
  {
    id: 'request-field-presence.precision',
    suite: 'capture-fidelity',
    category: 'request-field-presence',
    numerator: 'emitted request fields the spec declares',
    denominator: 'request fields infer emitted, on matched endpoints',
    gate: atLeast(0.95, 'calibration'),
  },
  {
    id: 'request-field-presence.recall',
    suite: 'capture-fidelity',
    category: 'request-field-presence',
    numerator: 'spec request fields infer emitted',
    denominator: 'request fields the spec declares, on matched endpoints',
    gate: atLeast(0.9, 'calibration'),
  },
  {
    id: 'response-field-presence.precision',
    suite: 'capture-fidelity',
    category: 'response-field-presence',
    numerator: 'emitted (status, pointer) response fields the spec declares',
    denominator: 'response fields infer emitted, on matched endpoints',
    gate: atLeast(0.95, 'calibration'),
    why: 'the half that is genuinely about inference, and the half a richer seed makes WORSE rather than better. 0046: 307 of 308 false positives were one data-keyed map modelled as a record type, and more route groups would mean more spurious fields. Unchanged by the split — the denominator is the same set — so the number before and after is comparable',
  },
  {
    /**
     * Over endpoints whose body was actually observed, and the rename says so.
     *
     * 0046 measured the misses: of 208, **62 come from five endpoints the
     * seed never populates** — teams, comments, notifications, tokens,
     * caldav. No body was observed, so no schema exists, and no inference
     * could have produced one. Scoring those against infer reports the
     * crawl's seeding as inference quality, which is 0015 §3's argument and
     * 0021's finding arriving for the third time.
     *
     * The excluded population does not vanish: `seed-coverage` below is it,
     * reported as capture's number. A ceiling that bounds a metric must be
     * visible beside it, or the metric reads as a verdict on the wrong stage.
     */
    id: 'response-field-presence.observed-body-recall',
    suite: 'capture-fidelity',
    category: 'response-field-presence',
    numerator: 'spec (status, pointer) response fields infer emitted',
    denominator:
      'response fields the spec declares, on matched endpoints, at (ENDPOINT, STATUS) SLOTS THE CRAWL OBSERVED A BODY FOR — per status, because an observed 401 error body does not make a 200 collection reachable',
    gate: atLeast(0.9, 'calibration'),
    why: 'renamed as well as re-scoped, because `recall` over a denominator the crawl chose is a number the next reader will compare against another target’s recall and draw a conclusion about infer from',
  },
  {
    id: 'response-field-presence.seed-coverage',
    suite: 'capture-fidelity',
    category: 'response-field-presence',
    numerator: 'declared response fields at an (endpoint, status) slot the crawl observed a body for',
    denominator: 'ALL response fields the spec declares, on matched endpoints',
    gate: null,
    why: 'the other half of the split, kept visible rather than dropped — the same treatment as `auth.unprobeable-count`. It is a property of the seed and the crawl, not of infer: an instance with no team, comment, notification or token simply has fewer bodies to infer from, and a reader comparing two observed-body-recall numbers needs to see that before comparing them. Ungated on purpose; gating it would make it a target and the fix would be to seed for the metric',
  },
  {
    id: 'field-type.accuracy',
    suite: 'capture-fidelity',
    category: 'field-type',
    numerator: 'matched fields whose JSON type equals the spec’s, under the two fixed normalisations',
    denominator: 'matched fields the spec types',
    gate: atLeast(0.9, 'calibration'),
    why: '`integer` counts as `number`; a nullable type matches its non-nullable counterpart where the spec marks the field optional. Fixed in advance so they cannot be argued after seeing a score',
  },
  {
    id: 'narrowing.precision',
    suite: 'capture-fidelity',
    category: 'narrowing',
    numerator: 'emitted narrowings the spec agrees with',
    denominator: 'narrowings infer emitted',
    gate: atLeast(0.98, 'structural'),
    why: '§13: narrowing must be justified, widening is free. A wrong enum makes valid states of the real system unrepresentable in the clone and corrupts every trajectory through the field',
  },
  {
    id: 'narrowing.recall',
    suite: 'capture-fidelity',
    category: 'narrowing',
    numerator: 'spec narrowings infer emitted',
    denominator: 'narrowings the spec declares, on matched fields',
    gate: null,
    why: 'a missed enum costs an over-permissive mock, which is the cheap direction',
  },
  {
    id: 'identifier.precision',
    suite: 'capture-fidelity',
    category: 'identifier',
    numerator: 'emitted `identifier.pathParamOf` claims the spec corroborates',
    denominator: 'identifiers infer emitted',
    gate: atLeast(0.9, 'calibration'),
  },
  {
    id: 'identifier.recall',
    suite: 'capture-fidelity',
    category: 'identifier',
    numerator: 'spec-derivable foreign keys infer emitted',
    denominator: 'foreign keys derivable from the spec, on matched endpoints',
    gate: atLeast(0.8, 'calibration'),
  },
  {
    id: 'synthesized-endpoint.precision',
    suite: 'capture-fidelity',
    category: 'synthesized-endpoint',
    numerator: '`discovery: bound-from-control` endpoints the spec declares',
    denominator: 'synthesized endpoints infer emitted',
    gate: atLeast(0.9, 'structural'),
    why: '§7.6 binds a URL read out of a form action for a control capture never fired — the highest-hallucination-risk claim in the model. Recall is meaningless: not binding a control is a gap, which is the correct outcome',
  },
  {
    id: 'auth.under-gate-count',
    suite: 'capture-fidelity',
    category: 'auth',
    numerator: 'endpoints infer leaves open where the truth is `required`',
    denominator: 'endpoints where the truth sweep OBSERVED required — never the whole surface',
    gate: atMost(0, 'structural'),
    why: 'the invisible failure: every §10 auth task reading through it is bypassable and the trajectory reads as success. A count and not a rate, because a rate invites trading a leak against volume',
  },
  {
    id: 'auth.over-gate-rate',
    suite: 'capture-fidelity',
    category: 'auth',
    numerator: 'endpoints infer gates where the truth is `not-required`',
    denominator: 'endpoints where the truth sweep OBSERVED not-required — never the whole surface',
    gate: atMost(0.2, 'calibration'),
    why: 'the visible, cheap failure — one login step, and failing closed on a genuinely unknown endpoint is correct behaviour rather than an error',
  },
  {
    id: 'auth.truth-coverage',
    suite: 'capture-fidelity',
    category: 'auth',
    numerator: 'graded endpoints the truth sweep observed anonymously',
    denominator: 'ALL GRADED endpoints',
    gate: null,
    why: 'the two metrics above are over what the sweep observed, and on the pinned Gitea that is 50 of 482 operations. Reported as a number rather than a footnote: an under-gate count of zero over 37 endpoints is not the same claim as one over 482, and without this the report cannot tell them apart',
  },
  {
    id: 'auth.evidence-coverage',
    suite: 'capture-fidelity',
    category: 'auth',
    numerator: 'probeable reads resolved from recorded evidence rather than the fail-closed default',
    denominator:
      'PROBEABLE READS among graded endpoints — the GETs capture actually issued, which are the only operations §6 permits an anonymous re-issue of',
    gate: atLeast(0.7, 'calibration'),
    why: 'what stops the degenerate model scoring well: gating everything gives an under-gate count of zero and evidence coverage near zero. Over probeable reads rather than the whole surface, because §6 forbids re-issuing a mutation anonymously — it would change the target’s state — so a mutation’s verdict can never rest on a probe and averaging the two populations bounds the metric below 1 for a reason that is a property of the API rather than of infer. Now 1.0 is achievable and a shortfall means the anonymous crawl missed a read',
  },
  {
    id: 'auth.unprobeable-count',
    suite: 'capture-fidelity',
    category: 'auth',
    numerator: 'graded operations whose auth verdict cannot rest on a probe — mutations, and controls capture never fired',
    denominator: 'reported as a count; there is no denominator and inventing one would re-merge the populations',
    gate: null,
    why: 'the other half of the split, kept visible rather than dropped. It is a property of the API surface, not of infer: an API that is mostly mutations simply has more verdicts resting on the fail-closed default, and a reader comparing two evidence-coverage numbers needs to see that before comparing them',
  },
  // ---- suite: inference (0023) ---------------------------------------------
  //
  // Paired to a definition **through the matched operation**, never by name:
  // `entityNameFor` derives a name from a path segment and cannot know the
  // document says `models.Project`.
  {
    id: 'entity-identity.precision',
    suite: 'inference',
    category: 'entity-identity',
    numerator: 'model entities pairing one-to-one with a definition the document declares',
    denominator: 'MODEL ENTITY OBJECTS reachable from a matched operation — objects, never distinct names',
    gate: atLeast(0.9, 'calibration'),
    why: 'an under-merging dedup emits two entities for one declared definition and both count as ambiguous, which is what makes this the first metric any piece of infer can move. The denominator counts objects because keying it by entity name let seven entities with four names between them collapse into four keys and report the same score as the deduplicated model',
  },
  {
    id: 'entity-identity.recall',
    suite: 'inference',
    category: 'entity-identity',
    numerator: 'declared definitions the model modelled as an entity',
    denominator: 'NOT DERIVED — the document does not declare which of its definitions are tables',
    gate: null,
    why: '0023 §3.1 measured three candidate criteria and every one misclassified: the reachable-response-root set makes recall 0.400 of which no miss is an inference defect (three collections came back empty, three are a token mint, a delete envelope and a capability blob that §7 says to decline); an identity-key test borrows IDENTITY_KEYS from infer so a bug moves both sides; and addressable-by-id admits a `Message` returned by DELETE while rejecting the user row. A metric here would report the crawl’s seeding as inference quality — 0015 §3’s argument one level down',
  },
  {
    id: 'entity-field-presence.precision',
    suite: 'inference',
    category: 'entity-field-presence',
    numerator: 'emitted entity fields the paired definition declares',
    denominator: 'entity fields the model emitted, on paired entities',
    gate: atLeast(0.95, 'calibration'),
    why: 'reads high for a reason that is not inference quality — both sides describe the same server, so it measures document/server agreement plus the field-name transform. It can fall and it is not a conservation check, but it must not be read as "the extraction is perfect"',
  },
  {
    id: 'entity-field-presence.recall',
    suite: 'inference',
    category: 'entity-field-presence',
    numerator: 'declared properties the model carries as an entity field',
    denominator: 'EVERY property the document declares on paired entities — scalar, object and array alike',
    gate: atLeast(0.9, 'calibration'),
    why: '`FieldTypeSchema`’s `json` member carries an object or an array, so every declared property is a claim SiteModel CAN make and 0018’s vocabulary rule permits excluding only claims it cannot. So infer dropping array properties is a visible miss rather than an exemption, which is right: §8 seeds the store from these, and a Task with no `labels` is a real hole in the clone',
  },
  {
    id: 'entity-relation.precision',
    suite: 'inference',
    category: 'entity-relation',
    numerator: 'emitted foreign keys the document corroborates',
    denominator: 'NOT DERIVED — the one reachable declared relation is a shape RelationSchema cannot express',
    gate: null,
    why: '0023 §3.2, measured: the document declares exactly one relation reachable from a matched operation, `models.Task.labels → models.Label`, an array of embedded objects. `RelationSchema` carries a scalar field plus `references`, and `FieldTypeSchema` has no array member — so the claim is unexpressible. Meanwhile `Task.project_id` IS expressible and the document declares it a bare integer with a prose description, linking it to nothing. Truth side empty after the vocabulary restriction, which is 0018’s UNEXPRESSIBLE_FORMATS argument and not a shortfall — and a genuine gap in SiteModel',
  },
  {
    id: 'entity-relation.recall',
    suite: 'inference',
    category: 'entity-relation',
    numerator: 'document-declared relations the model emitted',
    denominator: 'NOT DERIVED — see entity-relation.precision',
    gate: null,
  },
  {
    id: 'entity-narrowing.precision',
    suite: 'inference',
    category: 'entity-narrowing',
    numerator: 'emitted entity-field narrowings the declared domain agrees with',
    denominator: 'enum narrowings the model emitted on paired entity fields',
    gate: atLeast(0.98, 'structural'),
    why: 'the same argument as `narrowing.precision`, on the artifact §8 actually builds the store from: a wrong enum on an entity field makes valid states of the real system unrepresentable in the clone. Enum-only on both sides, because this document declares zero formats and silence about a field is not a claim that the field is unconstrained',
  },
  {
    id: 'entity-narrowing.recall',
    suite: 'inference',
    category: 'entity-narrowing',
    numerator: 'declared closed domains the model narrowed',
    denominator: 'ENUM claims the document declares on paired entity fields — measured: 1',
    gate: null,
    why: 'where the enum ladder is finally scored, and the denominator is 1 — `models.Task.repeat_mode`. Reported as coarse rather than relaxed, the treatment 0021 gave `auth.over-gate-rate`’s denominator of one: it is a property of this API and this crawl. Agreement is presence plus cardinality, not membership, because `NarrowingRecord` carries the evidence for an enum and not its value set',
  },
];

/** Every category, in table order. */
export const GRADE_CATEGORIES: readonly GradeCategoryId[] = [
  ...new Set(GRADE_METRICS.map((m) => m.category)),
];

/** Every suite, in table order. Derived, so a suite nobody uses cannot exist. */
export const GRADE_SUITES: readonly GradeSuiteId[] = [...new Set(GRADE_METRICS.map((m) => m.suite))];

/** The categories in one suite, in table order. */
export const categoriesInSuite = (suite: GradeSuiteId): readonly GradeCategoryId[] => [
  ...new Set(GRADE_METRICS.filter((m) => m.suite === suite).map((m) => m.category)),
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
    suites: GRADE_SUITES,
    // `suite` is in here because it decides what a number is a claim *about*,
    // and `conservation` because it decides whether a number is a claim at all.
    // Leaving either out would let a metric change subject, or stop being a
    // measurement, without the digest noticing — which is the quiet change the
    // digest exists to catch. `why` stays out: an explanation improving must not
    // look like a metric changing, and vice versa.
    metrics: GRADE_METRICS.map((m) => [
      m.id,
      m.suite,
      m.category,
      m.numerator,
      m.denominator,
      m.gate,
      m.conservation ?? null,
    ]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Committed constant. A test asserts it equals `computeGradeContractDigest()`,
 * so moving a threshold without updating this line fails the suite.
 */
export const GRADE_CONTRACT_DIGEST =
  'b091111df3b3f5804cfdd8d61c808d1f19b773ba2a70bb304184a602910a7e2c';

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
const DivergenceEvidenceSchema = z.strictObject({
  request: z.string().min(1),
  responseStatus: z.int(),
  responseExcerpt: z.string().min(1),
  observedAt: z.string().min(1),
});

const divergenceCore = {
  /** Which scored category this exclusion removes something from. */
  category: GradeCategoryIdSchema,
  /** Spec-relative path, as written in the document. */
  specPath: z.string().min(1),
  method: z.string().min(1).toUpperCase(),
  /** The claim the spec makes. */
  specSays: z.string().min(1),
  /** What the server actually does. */
  serverDoes: z.string().min(1),
  /** The recorded exchange proving it. A belief is not evidence. */
  evidence: DivergenceEvidenceSchema,
};

/**
 * Two scopes, because an endpoint exclusion and a field exclusion are not the
 * same unit (0033 §3).
 *
 * `endpoint` is the original shape. `field` was added for Vikunja's four
 * contradicted slots: the document declares `view_kind` an `integer` enum of
 * `0..3` and the server sends `"list"`. Excluding the whole endpoint to fix two
 * narrowing slots would have removed dozens of correctly-scored fields from
 * `response-field-presence` and `field-type` as a side effect — four other
 * categories moved by an entry that names neither.
 *
 * The `evidence` requirement is identical for both and is not relaxed for the
 * new scope: the recorded exchange is what separates "the spec is stale" from
 * "infer disagrees", and 0015 says the latter is not evidence.
 */
export const KnownDivergenceSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('endpoint'), ...divergenceCore }),
  z.strictObject({
    scope: z.literal('field'),
    ...divergenceCore,
    /** Response status the slot belongs to, matching the grader's `status#pointer` key. */
    status: z.string().min(1),
    /** RFC 6901 over the payload, `/[]` for an array element — `modelFieldPointers`' language. */
    pointer: z.string().startsWith('/'),
  }),
]);
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
  /**
   * Field-scope entries, budgeted against the denominator of the category they
   * exclude from rather than against graded endpoints (0033 §3).
   *
   * `overCap` here is per category and says something narrower than the global
   * one: this document is not fit for grading *that category* on this target.
   */
  readonly perCategoryFields: ReadonlyArray<{
    category: GradeCategoryId;
    count: number;
    denominator: number;
    cap: number;
    overCap: boolean;
    concentrated: boolean;
  }>;
  readonly messages: readonly string[];
}

/**
 * @param categoryDenominators the scored denominator of each category, used to
 *   budget `field`-scope entries. A category absent from the map has none, and
 *   any field entry against it is unbudgetable rather than free — see below.
 */
export function assessDivergenceBudget(
  entries: readonly KnownDivergence[],
  gradedEndpoints: number,
  categoryDenominators: ReadonlyMap<GradeCategoryId, number> = new Map(),
): DivergenceBudget {
  const cap = gradedEndpoints * DIVERGENCE_CAP;
  const categoryCap = cap * DIVERGENCE_CATEGORY_SHARE;

  // The two units, separated before anything is counted. Four *fields* against a
  // cap derived from twenty-one *endpoints* is not a threshold that is too tight
  // — it is a ratio between two different things, and moving it would not help.
  const endpointEntries = entries.filter((e) => e.scope === 'endpoint');
  const fieldEntries = entries.filter((e) => e.scope === 'field');

  const counts = new Map<GradeCategoryId, number>();
  for (const entry of endpointEntries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  const perCategory = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const concentrated = perCategory.filter((c) => c.count > categoryCap).map((c) => c.category);
  const overCap = endpointEntries.length > cap;

  const fieldCounts = new Map<GradeCategoryId, number>();
  for (const entry of fieldEntries) fieldCounts.set(entry.category, (fieldCounts.get(entry.category) ?? 0) + 1);
  const perCategoryFields = [...fieldCounts.entries()]
    .map(([category, count]) => {
      // A category with no denominator cannot budget an exclusion, and treating
      // that as "under cap" is the empty-container admission §13 forbids: the
      // permissive answer to a question nobody could answer. Zero makes every
      // count exceed it, which is the failing-closed direction.
      const denominator = categoryDenominators.get(category) ?? 0;
      const fieldCap = denominator * DIVERGENCE_CAP;
      return {
        category,
        count,
        denominator,
        cap: fieldCap,
        overCap: count > fieldCap,
        concentrated: count > fieldCap * DIVERGENCE_CATEGORY_SHARE,
      };
    })
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const messages: string[] = [];
  if (overCap) {
    messages.push(
      `known divergence covers ${endpointEntries.length} of ${gradedEndpoints} graded endpoints, over the ${(DIVERGENCE_CAP * 100).toFixed(0)}% cap. Past that the ground truth is not fit for grading and the problem is the target, not the threshold.`,
    );
  }
  for (const category of concentrated) {
    const count = counts.get(category) ?? 0;
    messages.push(
      `known divergence is concentrated in ${category}: ${count} entries against a per-category budget of ${categoryCap.toFixed(1)}. A spec stale in one direction is plausible; a spec stale exactly where infer is weakest is the shape this cap exists to catch. Re-examine before another entry lands there.`,
    );
  }
  for (const row of perCategoryFields) {
    if (row.overCap) {
      messages.push(
        `field-level divergence in ${row.category} covers ${row.count} of ${row.denominator} scored slot(s), over the ${(DIVERGENCE_CAP * 100).toFixed(0)}% cap of ${row.cap.toFixed(2)}. This document is not fit for grading ${row.category} on this target.`,
      );
    } else if (row.concentrated) {
      messages.push(
        `field-level divergence is concentrated in ${row.category}: ${row.count} of ${row.denominator} slot(s). Re-examine before another entry lands there.`,
      );
    }
  }
  return {
    gradedEndpoints, total: entries.length, cap, categoryCap, perCategory,
    overCap, concentrated, perCategoryFields, messages,
  };
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
