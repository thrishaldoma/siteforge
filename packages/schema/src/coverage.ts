/**
 * `coverage.json` — what the raw input contained, against what extraction produced.
 *
 * Every extraction bug found so far has been a **silent drop**: the input had
 * something, the output did not, and nothing failed. The rung-2 measurement
 * found three in one run, all of them visible only by reading counts by hand:
 * every `[aria-expanded="true"]` rule dropped, `.btn:focus-visible` matching
 * zero nodes instead of seventeen, and sticky firing once per scroll step.
 *
 * A coverage invariant is a contradiction between input and output that no
 * correct run can produce. Two properties make one actually work, both learned
 * by deliberately reintroducing a fixed bug and watching the check stay green:
 *
 *   1. **The observed side must be derived independently of the extraction.**
 *      Counting inputs with the same parser the extractor uses means a bug in
 *      that parser moves both sides, and the invariant goes vacuous rather than
 *      failing. Observed counts come from raw text with a cruder detector;
 *      over-counting there is safe, sharing a code path is not.
 *
 *   2. **It must compare like with like.** An aggregate output count lets one
 *      category mask another's disappearance. They are cheap, general, and they would have caught
 * all three automatically.
 *
 * **Standing rule:** whenever a rung finds a silent drop, add the invariant that
 * would have caught it. This list is meant to grow.
 */
import { z } from 'zod';
import { RouteIdSchema, SiteIdSchema } from './primitives.js';
import { SessionProbePolicySchema } from './context.js';
import { artifactEnvelope } from './artifact.js';

/** What the raw inputs contained, counted before extraction ran. */
export const CoverageObservedSchema = z.strictObject({
  /** `document.styleSheets.length`, including inline `<style>`. */
  stylesheets: z.int().nonnegative(),
  /** Style rules whose selector parses to at least one interaction pseudo-class. */
  cssPseudoClassRules: z.int().nonnegative(),
  /** Style rules whose selector parses to at least one `aria-*`/`data-*` attribute. */
  cssAttributeStateRules: z.int().nonnegative(),
  cssFontFaceRules: z.int().nonnegative(),
  /** HAR entries whose resource type is xhr or fetch. */
  harXhrEntries: z.int().nonnegative(),
  /**
   * Distinct HTTP methods seen in that traffic, counted from the raw method
   * strings — no path normalization, no grouping, nothing the endpoint inferencer
   * touches. Deliberately crude so a bug in inference cannot move both sides.
   */
  harDistinctMethods: z.int().nonnegative(),
  /** `scrollHeight / viewportHeight`. Above 2 means the page genuinely scrolls. */
  documentHeightRatio: z.number().nonnegative(),
  /** AX nodes with an interactive role, from CDP. */
  axInteractiveRoles: z.int().nonnegative(),
  /** Elements the browser actually requested a subresource for. */
  subresourceRequests: z.int().nonnegative(),
  /**
   * Requests that went out carrying a `cookie` or `authorization` header,
   * counted from raw header names on the wire — not from anything the endpoint
   * inferencer produces.
   */
  harCredentialedRequests: z.int().nonnegative(),
  /**
   * What probing was possible at all.
   *
   * Coverage is only comparable within a policy: an interactive capture has one
   * session to spend and can fire at most one session-destructive control, so
   * holding it to a credentialed capture's standard would fail a run that did
   * everything it was able to.
   */
  sessionProbePolicy: SessionProbePolicySchema,
  /** Controls classified session-destructive, counted at discovery. */
  sessionDestructiveControls: z.int().nonnegative(),
  /**
   * `<select>` elements in the captured DOM, counted from `dom.json`'s node
   * tree — **never from the extractor's own `querySelectorAll`.**
   *
   * That independence is the whole point of the rule and it is what this
   * particular invariant needs most: the bug was *in the selector*. An observed
   * side that asked the page the same question the extractor asked would have
   * returned zero too, and the check would have read green over a page holding
   * six of them. `dom.json` is built by a different traversal, for a different
   * purpose, and cannot agree with the extractor by sharing its mistake.
   */
  domSelectElements: z.int().nonnegative(),
  /** Distinct `name` values among `input[type=radio]` nodes in `dom.json`. */
  domRadioGroups: z.int().nonnegative(),
  /**
   * How many of `integer` / `number` / `boolean` appear as leaves in the raw
   * response bodies. Walked with a crude recursive descent that shares no code
   * with `inferSchema` — no dedup, no identity, no depth cap.
   */
  bodyScalarKinds: z.int().nonnegative().max(3),
});

/** What extraction produced from those inputs. */
export const CoverageExtractedSchema = z.strictObject({
  styleTableEntries: z.int().nonnegative(),
  /**
   * Split by kind on purpose. An aggregate `statesCssom` lets one category mask
   * another's disappearance: with attribute-state extraction fully broken, the
   * surviving pseudo-class entries kept the total non-zero and the invariant
   * held. An invariant must compare like with like.
   */
  statesCssomPseudo: z.int().nonnegative(),
  statesCssomAttribute: z.int().nonnegative(),
  statesProbed: z.int().nonnegative(),
  statesScroll: z.int().nonnegative(),
  fonts: z.int().nonnegative(),
  endpoints: z.int().nonnegative(),
  /** Distinct methods across the inferred endpoint descriptors. */
  endpointDistinctMethods: z.int().nonnegative(),
  scrollSteps: z.int().nonnegative(),
  interactionCandidates: z.int().nonnegative(),
  assets: z.int().nonnegative(),
  a11yNodes: z.int().nonnegative(),
  /**
   * Endpoints whose auth verdict rests on at least one recorded observation.
   *
   * Compared for *equality* with `endpoints`, not for non-emptiness: decision
   * 0008's lesson is that a total hides a partial loss, and this is precisely a
   * per-endpoint drop.
   */
  endpointsWithAuthEvidence: z.int().nonnegative(),
  /** Session-destructive controls actually fired. */
  sessionDestructiveFired: z.int().nonnegative(),
  /**
   * Controls that were fired and produced a recorded transition.
   *
   * With `controlsUndriveable` this is a **coverage ceiling**, not only a
   * defect count: a control that cannot be driven is one whose behaviour §6
   * never observes, whose transition §9's behavioural gate can never replay,
   * and whose handler §7.6 has to recover from source or not at all. On the
   * pinned Vikunja 49 of 51 timeouts are on off-screen elements, and that
   * caps what any downstream stage can know about this target — which belongs
   * beside the crawl's other coverage numbers rather than in a findings list.
   *
   * No invariant is attached, deliberately. "Probing must succeed" would be an
   * assertion about the *target's* driveability rather than about extraction
   * dropping something it held, and every other invariant here is the latter.
   */
  controlsFired: z.int().nonnegative(),
  /** Discovered, activated, and would not resolve. The other half of the ceiling. */
  controlsUndriveable: z.int().nonnegative(),
  /**
   * Option-set controls extraction produced, **split by kind**.
   *
   * Split for decision 0008's reason: an aggregate lets one category mask
   * another's loss, and these two are extracted by different rules — `<select>`
   * by tag alone, radio groups by shared `name`, which is load-bearing for a
   * radio and incidental for a select. A single total would let surviving radio
   * groups hide every select disappearing, which is exactly the shape that kept
   * `statesCssom` green while attribute states were entirely broken.
   */
  uiConstraintSelects: z.int().nonnegative(),
  uiConstraintRadioGroups: z.int().nonnegative(),
  /**
   * Of those, the ones §7.5's ladder can currently *use*: they offer at least
   * one option value and they carry a name to key on.
   *
   * Reported without an invariant, deliberately. A control extraction saw and
   * declined to index is not a silent drop — the count above proves it was
   * seen, and the gap between the two is the size of the binding problem
   * (docs/decisions/0029), not a defect. Asserting on it would be asserting
   * that a target names its form controls, which is not ours to require.
   */
  uiConstraintsBindable: z.int().nonnegative(),
  /**
   * How many of those kinds have at least one schema node carrying `examples`.
   *
   * Compared against `bodyScalarKinds` for equality. Kind is the granularity at
   * which the two sides are comparable at all — one counts values in bodies,
   * the other nodes in a schema, and dedup, array folding and the depth cap
   * legitimately separate the two populations. It is also granular enough:
   * `examples` was recorded only in the `string` branch, so booleans and
   * integers were lost together here, but a driver that lost only integers
   * fails this too, and would not fail a single total.
   */
  scalarKindsWithExamples: z.int().nonnegative().max(3),
});

export type CoverageObserved = z.infer<typeof CoverageObservedSchema>;
export type CoverageExtracted = z.infer<typeof CoverageExtractedSchema>;

export interface CoverageInvariant {
  id: string;
  /** Stated as the implication it enforces, so a failure reads as a sentence. */
  description: string;
  /** True when the invariant does not apply — the input had nothing to drop. */
  vacuous: (o: CoverageObserved) => boolean;
  holds: (o: CoverageObserved, e: CoverageExtracted) => boolean;
}

/**
 * The invariants. Each is "the input contained X, therefore the output must
 * contain Y" — a contradiction no correct extraction can produce.
 */
export const COVERAGE_INVARIANTS: readonly CoverageInvariant[] = [
  {
    id: 'stylesheets-imply-style-table',
    description: 'a page with stylesheets must produce a non-empty style table',
    vacuous: (o) => o.stylesheets === 0,
    holds: (_o, e) => e.styleTableEntries > 0,
  },
  {
    id: 'pseudo-classes-imply-pseudo-states',
    description: 'CSS containing interaction pseudo-classes must produce pseudo-class state entries',
    vacuous: (o) => o.cssPseudoClassRules === 0,
    holds: (_o, e) => e.statesCssomPseudo > 0,
  },
  {
    id: 'attribute-states-imply-attribute-states',
    description: 'CSS containing aria-*/data-* attribute selectors must produce attribute state entries',
    vacuous: (o) => o.cssAttributeStateRules === 0,
    holds: (_o, e) => e.statesCssomAttribute > 0,
  },
  {
    id: 'font-face-implies-fonts',
    description: '@font-face rules must produce font descriptors',
    vacuous: (o) => o.cssFontFaceRules === 0,
    holds: (_o, e) => e.fonts > 0,
  },
  {
    id: 'xhr-implies-endpoints',
    description: 'XHR or fetch traffic must produce endpoint descriptors',
    vacuous: (o) => o.harXhrEntries === 0,
    holds: (_o, e) => e.endpoints > 0,
  },
  {
    // Added after rung 3: 29 XHR exchanges across GET, PATCH and POST collapsed
    // into a single GET endpoint, and `xhr-implies-endpoints` was satisfied by
    // that one. Non-emptiness is not enough when the loss is partial.
    id: 'methods-imply-endpoint-methods',
    description: 'every HTTP method seen in XHR traffic must appear in some endpoint descriptor',
    vacuous: (o) => o.harDistinctMethods === 0,
    holds: (o, e) => e.endpointDistinctMethods >= o.harDistinctMethods,
  },
  {
    // Added after decision 0010. Auth evidence was read from Playwright's
    // `request.headers()`, which omits cookies — so "every observation carried a
    // credential" could never fire and every endpoint the anonymous crawl never
    // reached recorded no evidence at all. Silent, and invisible in the totals:
    // the one endpoint an anonymous probe *had* refused looked fine.
    //
    // The observed side counts raw header names on the wire, sharing no code
    // with the inferencer. The assertion is an equality, so losing one
    // endpoint's evidence fails even while the others keep theirs.
    id: 'credentialed-traffic-implies-auth-evidence',
    description: 'when credentialed requests were seen, every endpoint must record the observations its auth verdict rests on',
    vacuous: (o) => o.harCredentialedRequests === 0,
    holds: (_o, e) => e.endpointsWithAuthEvidence === e.endpoints,
  },
  {
    // Added with decision 0012. A control whose only cost is our own session
    // must be captured — logout is an ordinary endpoint §8 implements and §10's
    // auth tasks depend on. Skipping one leaves a core auth flow uncaptured and
    // filed as unreliable.
    //
    // Mode-aware on purpose: under `interactive` there is one unrepeatable
    // session, so at most one can be fired and the invariant must not demand
    // more. Comparing an interactive capture against a credentialed one as if
    // they were equivalent is how a correct run gets failed.
    id: 'session-destructive-controls-are-fired',
    description: 'every session-destructive control must be fired when a replacement session can be obtained',
    vacuous: (o) => o.sessionDestructiveControls === 0 || o.sessionProbePolicy !== 'credentialed',
    holds: (o, e) => e.sessionDestructiveFired >= o.sessionDestructiveControls,
  },
  {
    id: 'tall-document-implies-scroll-steps',
    description: 'a document taller than 2 viewports must produce more than one scroll step',
    vacuous: (o) => o.documentHeightRatio <= 2,
    holds: (_o, e) => e.scrollSteps > 1,
  },
  {
    id: 'interactive-roles-imply-candidates',
    description: 'an a11y tree with interactive roles must produce interaction candidates',
    vacuous: (o) => o.axInteractiveRoles === 0,
    holds: (_o, e) => e.interactionCandidates > 0,
  },
  {
    // Added after the Vikunja crawl. `entity-narrowing.recall` and
    // `narrowing.recall` were both reported as model-side floors on the strength
    // of six `<select>` elements sitting in the captured DOM that extraction
    // produced nothing from: the selector was `select[name], select[id]` and
    // every one of them carried only `data-v-321f61a6`. Six in, zero out,
    // nothing failed — §6's standing rule names exactly this.
    //
    // An equality, not a non-emptiness: the loss was total here, but a
    // framework that names four selects of six would satisfy `> 0` while
    // dropping a third of the primary evidence §7.5 ranks first.
    id: 'selects-imply-option-set-controls',
    description: 'every <select> in the captured DOM must produce an option-set control',
    vacuous: (o) => o.domSelectElements === 0,
    holds: (o, e) => e.uiConstraintSelects === o.domSelectElements,
  },
  {
    id: 'radio-groups-imply-option-set-controls',
    description: 'every radio group in the captured DOM must produce an option-set control',
    vacuous: (o) => o.domRadioGroups === 0,
    holds: (o, e) => e.uiConstraintRadioGroups === o.domRadioGroups,
  },
  {
    // Added with the Vikunja crawl, from the same audit as the two above.
    // `examples` was recorded inside `inferSchema`'s `string` branch only, so
    // the terminal `return { type: kind }` dropped every observed integer,
    // number and boolean: 0 of 68 numeric nodes carried a value against 273 of
    // 324 string nodes. §8 seeds the mock store from captured responses, so
    // every numeric field in the clone was seeding from nothing.
    id: 'scalar-values-imply-recorded-examples',
    description: 'every scalar kind seen in a response body must have some schema node recording observed values',
    vacuous: (o) => o.bodyScalarKinds === 0,
    holds: (o, e) => e.scalarKindsWithExamples === o.bodyScalarKinds,
  },
  {
    id: 'subresources-imply-assets',
    description: 'requested subresources must produce asset entries',
    vacuous: (o) => o.subresourceRequests === 0,
    holds: (_o, e) => e.assets > 0,
  },
];

export const CoverageInvariantResultSchema = z.strictObject({
  id: z.string().min(1),
  description: z.string().min(1),
  /** True when the input had nothing for this invariant to be about. */
  vacuous: z.boolean(),
  holds: z.boolean(),
  detail: z.string().optional(),
});

export const CoverageReportSchema = z.strictObject({
  ...artifactEnvelope('coverage-report'),
  siteId: SiteIdSchema,
  /** Routes these counts aggregate over. */
  routeIds: z.array(RouteIdSchema),
  observed: CoverageObservedSchema,
  extracted: CoverageExtractedSchema,
  invariants: z.array(CoverageInvariantResultSchema).min(1),
});

/** Evaluate every invariant. A non-vacuous invariant that does not hold fails the run. */
export function evaluateCoverage(
  observed: CoverageObserved,
  extracted: CoverageExtracted,
): z.infer<typeof CoverageInvariantResultSchema>[] {
  return COVERAGE_INVARIANTS.map((inv) => {
    const vacuous = inv.vacuous(observed);
    return {
      id: inv.id,
      description: inv.description,
      vacuous,
      holds: vacuous ? true : inv.holds(observed, extracted),
    };
  });
}

export type CoverageInvariantResult = z.infer<typeof CoverageInvariantResultSchema>;
export type CoverageReport = z.infer<typeof CoverageReportSchema>;
