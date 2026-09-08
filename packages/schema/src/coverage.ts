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
  /** `scrollHeight / viewportHeight`. Above 2 means the page genuinely scrolls. */
  documentHeightRatio: z.number().nonnegative(),
  /** AX nodes with an interactive role, from CDP. */
  axInteractiveRoles: z.int().nonnegative(),
  /** Elements the browser actually requested a subresource for. */
  subresourceRequests: z.int().nonnegative(),
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
  scrollSteps: z.int().nonnegative(),
  interactionCandidates: z.int().nonnegative(),
  assets: z.int().nonnegative(),
  a11yNodes: z.int().nonnegative(),
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
