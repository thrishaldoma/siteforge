/**
 * Sabotage tests: proof that each coverage invariant detects its own bug.
 *
 * §13's standing rule — no invariant lands without a test that reintroduces the
 * silent drop and proves the invariant fails. It exists because two invariants
 * written to catch a specific bug were checked by hand against that bug and
 * stayed **green**, twice:
 *
 *   1. The observed side was counted with the same parser the extractor used, so
 *      breaking the parser moved both sides and the check went vacuous instead of
 *      failing. An invariant that never fires is indistinguishable from one that
 *      passes.
 *   2. The output side was an aggregate, so nine surviving pseudo-class entries
 *      kept the total non-zero while every attribute-state entry disappeared.
 *
 * Neither was visible by reading the invariant. Both were visible in ten seconds
 * by breaking the extractor and watching nothing happen. That is this file.
 *
 * The completeness test at the bottom is the part that makes the rule stick: a
 * new invariant added to `COVERAGE_INVARIANTS` without a sabotage case here fails
 * the suite. The rule is enforced, not remembered.
 */
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_INVARIANTS,
  evaluateCoverage,
  type CoverageExtracted,
  type CoverageObserved,
} from './index.js';

/** A capture where everything the input contained was extracted. */
const HEALTHY_OBSERVED: CoverageObserved = {
  stylesheets: 3,
  cssPseudoClassRules: 17,
  cssAttributeStateRules: 5,
  cssFontFaceRules: 2,
  harXhrEntries: 29,
  harDistinctMethods: 3,
  documentHeightRatio: 5.2,
  axInteractiveRoles: 22,
  subresourceRequests: 11,
  harCredentialedRequests: 36,
  sessionProbePolicy: 'credentialed',
  sessionDestructiveControls: 1,
};

const HEALTHY_EXTRACTED: CoverageExtracted = {
  styleTableEntries: 45,
  statesCssomPseudo: 9,
  statesCssomAttribute: 5,
  statesProbed: 1,
  statesScroll: 2,
  fonts: 2,
  endpoints: 3,
  endpointDistinctMethods: 3,
  scrollSteps: 9,
  interactionCandidates: 28,
  assets: 3,
  a11yNodes: 39,
  endpointsWithAuthEvidence: 3,
  sessionDestructiveFired: 1,
};

/**
 * One reintroduced bug per invariant.
 *
 * `drop` is what the extractor produces when that bug is back: the input still
 * contains the thing, the output no longer does. `silence` zeroes the input side,
 * which is the only honest reason for the check not to fire.
 */
interface Sabotage {
  id: string;
  /** What the bug looked like when it actually happened, where it did. */
  bug: string;
  drop: Partial<CoverageExtracted>;
  silence: Partial<CoverageObserved>;
}

const SABOTAGE: Sabotage[] = [
  {
    id: 'stylesheets-imply-style-table',
    bug: '`document.styleSheets.forEach is not a function` — the whole pass threw and was swallowed',
    drop: { styleTableEntries: 0 },
    silence: { stylesheets: 0 },
  },
  {
    id: 'pseudo-classes-imply-pseudo-states',
    bug: 'regex alternation put `focus` before `focus-visible`, so `.btn:focus-visible` became `.btn-visible` and matched nothing',
    drop: { statesCssomPseudo: 0 },
    silence: { cssPseudoClassRules: 0 },
  },
  {
    id: 'attribute-states-imply-attribute-states',
    bug: '`String.includes(\'[aria-expanded]\')` never matches `[aria-expanded="true"]`',
    drop: { statesCssomAttribute: 0 },
    silence: { cssAttributeStateRules: 0 },
  },
  {
    id: 'font-face-implies-fonts',
    bug: '@font-face rules skipped because CSSFontFaceRule has no selectorText',
    drop: { fonts: 0 },
    silence: { cssFontFaceRules: 0 },
  },
  {
    id: 'xhr-implies-endpoints',
    bug: 'the response handler was async and the page closed before it settled',
    // Both, because a capture with no endpoints cannot have three of them
    // carrying auth evidence. Dropping only `endpoints` modelled a record no
    // run can produce, and the isolation assertion below found it on its first
    // execution — §13's "the sabotage must reproduce the actual defect", caught
    // by a rule added for a different reason.
    drop: { endpoints: 0, endpointsWithAuthEvidence: 0 },
    silence: { harXhrEntries: 0 },
  },
  {
    id: 'methods-imply-endpoint-methods',
    bug: '29 exchanges across GET, PATCH and POST collapsed into a single GET endpoint',
    drop: { endpointDistinctMethods: 1 },
    silence: { harDistinctMethods: 0 },
  },
  {
    id: 'credentialed-traffic-implies-auth-evidence',
    bug: 'auth evidence read from `request.headers()`, which omits cookies, so two of three endpoints recorded none',
    drop: { endpointsWithAuthEvidence: 1 },
    silence: { harCredentialedRequests: 0 },
  },
  {
    id: 'session-destructive-controls-are-fired',
    bug: '"Sign out" skipped as destructive, leaving POST /api/auth/logout uncaptured while §10 depends on it',
    drop: { sessionDestructiveFired: 0 },
    silence: { sessionDestructiveControls: 0 },
  },
  {
    id: 'tall-document-implies-scroll-steps',
    bug: 'the scroll loop exited on the first step because scrollHeight was read before layout',
    drop: { scrollSteps: 1 },
    silence: { documentHeightRatio: 1 },
  },
  {
    id: 'interactive-roles-imply-candidates',
    bug: 'backendDOMNodeId never resolved, so no AX node mapped onto a captured node',
    drop: { interactionCandidates: 0 },
    silence: { axInteractiveRoles: 0 },
  },
  {
    id: 'subresources-imply-assets',
    bug: 'the route handler persisted bodies but the index was written before they resolved',
    drop: { assets: 0 },
    silence: { subresourceRequests: 0 },
  },
];

const resultFor = (id: string, observed: CoverageObserved, extracted: CoverageExtracted) =>
  evaluateCoverage(observed, extracted).find((r) => r.id === id)!;

describe('coverage invariants detect the bug they were written for (§13)', () => {
  it('holds across the board on a capture that dropped nothing', () => {
    const broken = evaluateCoverage(HEALTHY_OBSERVED, HEALTHY_EXTRACTED).filter(
      (r) => !r.vacuous && !r.holds,
    );
    expect(broken).toEqual([]);
  });

  it.each(SABOTAGE)('$id fails when the bug is back: $bug', ({ id, drop }) => {
    const result = resultFor(id, HEALTHY_OBSERVED, { ...HEALTHY_EXTRACTED, ...drop });
    // Both assertions matter. A vacuous result is the specific way these two
    // checks failed the first time: not a wrong answer, no answer at all.
    expect(result.vacuous).toBe(false);
    expect(result.holds).toBe(false);
  });

  it.each(SABOTAGE)('$id goes vacuous only when the input really had nothing', ({ id, drop, silence }) => {
    const result = resultFor(
      id,
      { ...HEALTHY_OBSERVED, ...silence },
      { ...HEALTHY_EXTRACTED, ...drop },
    );
    expect(result.vacuous).toBe(true);
  });

  /**
   * Property 2, as an executable statement rather than a comment.
   *
   * With attribute-state extraction fully broken, an aggregate `statesCssom`
   * would still read 9 because the pseudo-class entries survived — and an
   * invariant asserting "some state entries exist" would hold while five rules
   * silently vanished. Disaggregation is not tidiness; it is the difference
   * between a check and a decoration.
   */
  it('stays sensitive to a partial loss that an aggregate count would hide', () => {
    const extracted = { ...HEALTHY_EXTRACTED, statesCssomAttribute: 0 };
    const aggregate = extracted.statesCssomPseudo + extracted.statesCssomAttribute;
    expect(aggregate).toBeGreaterThan(0); // an aggregate invariant would pass here
    expect(resultFor('attribute-states-imply-attribute-states', HEALTHY_OBSERVED, extracted).holds)
      .toBe(false);
  });

  /**
   * The negative case (§13). Every test above removes something and watches an
   * invariant fail; none of them can tell that apart from an evaluator where
   * *any* change fails *everything*. A table made only of drops proves nothing
   * about isolation — so each drop has to leave every other invariant holding.
   *
   * This is the same assertion `checkRung` makes with `toEqual([key])`, moved to
   * the layer where the invariants actually live.
   */
  it.each(SABOTAGE)('$id fails alone — the other invariants do not move', ({ id, drop }) => {
    const results = evaluateCoverage(HEALTHY_OBSERVED, { ...HEALTHY_EXTRACTED, ...drop });
    const failing = results.filter((r) => !r.vacuous && !r.holds).map((r) => r.id);
    expect(failing).toEqual([id]);
  });

  /**
   * The rule, enforced. Adding an invariant without a sabotage case fails here,
   * which is the only reason a standing rule survives contact with a deadline.
   */
  it('has a sabotage case for every invariant that exists', () => {
    expect(SABOTAGE.map((s) => s.id).sort()).toEqual(
      COVERAGE_INVARIANTS.map((i) => i.id).sort(),
    );
  });
});
