/**
 * Vikunja as a ground truth — the M3 target (0019, 0021).
 *
 * Adopted because it passes both selection criteria: 16 of 18 observed browser
 * paths are declared by its own document, and `/api/v1` is a prefix the SPA
 * shell falls outside of, so the universe filter still filters. Swagger 2.0, so
 * the reader beside this file already understood it.
 *
 * **Its API is almost entirely gated, and that shapes one metric.** The
 * anonymous sweep found 24 of 25 zero-parameter GETs answering 401; the single
 * public read is `GET /api/v1/info`. Vikunja is a personal task manager, so
 * this is a property of the API and not a thin measurement. The consequence is
 * recorded rather than tuned around: `auth.over-gate-rate`'s denominator is the
 * endpoints the truth calls public, so against this target it is at most one
 * and the metric is coarse or vacuous. §6 scores vacuity as an outcome, which
 * is the right place for it to show up.
 *
 * The floor below therefore says `>= 1` where Gitea's says `>= 5`, and that
 * difference is the measurement, not a relaxation: a floor is "below this the
 * truth did not load", and one public read is what this API has.
 */
import {
  loadSwagger2Truth,
  buildSwagger2Truth,
  type Snapshot,
  type TruthModel,
  type TruthSource,
} from './swagger2.js';

export const VIKUNJA_TRUTH: TruthSource = {
  id: 'vikunja',
  specFile: 'docs.json',
  defaultBasePath: '/api/v1',
  notDerived: [
    {
      category: 'identifier',
      reason:
        'foreign keys derivable from the spec — this truth side is not derived (0015 modality table)',
    },
    {
      category: 'narrowing',
      reason:
        "this document declares no formats at all — zero occurrences of the string `format` in 368KB — and 7 enums, so silence about a field is not a claim that the field is unconstrained. Scoring a model's narrowings against it would mark a correct `date-time` on `created` as a false positive for the document's reticence. Not derived, for the same modality reason as `identifier`.",
    },
  ],
  /** Measured surface: 103 paths, 143 operations, 80 definitions, 1 public / 24 gated. */
  floors: (counts, endpoints) => [
    [counts.operations >= 100, `only ${counts.operations} operations loaded; the pinned image serves 143`],
    [counts.withPathParams >= 40, `only ${counts.withPathParams} operations carry a path parameter`],
    [counts.definitions >= 40, `only ${counts.definitions} definitions loaded`],
    [
      counts.authRequired >= 10,
      `the auth truth has ${counts.authRequired} gated endpoints — the anonymous sweep did not run`,
    ],
    [
      counts.authNotRequired >= 1,
      `the auth truth has no public endpoints at all. Vikunja has exactly one — GET /api/v1/info — and losing it means the sweep did not run rather than that the API changed.`,
    ],
    [
      endpoints.some((e) => e.responseFields.length > 0),
      'no response fields were enumerated; $ref resolution is broken',
    ],
    [
      endpoints.some((e) => e.requestFields.length > 0),
      'no request fields were enumerated; body parameters are not being read',
    ],
    /**
     * The floor that would have caught the `allOf` defect on the day Vikunja
     * was adopted.
     *
     * This generator writes a typed property as `allOf: [{ $ref }]` so it can
     * hang a `description` beside the reference — 32 times, where Gitea's
     * document uses the idiom zero times. Following only a bare `$ref` therefore
     * read every one of them as an untyped `object`, which silently deleted both
     * of the document's reachable closed-domain claims and every nested object
     * behind a wrapper. **Measured: 50 enum-bearing response fields with the
     * wrapper resolved, and 0 without.** A truth side that under-claims does not
     * report a smaller truth — it inflates every recall scored against it, so
     * the failure looks like a better number.
     */
    [
      endpoints.flatMap((e) => e.responseFields).filter((f) => f.enumValues !== null).length >= 20,
      'no enum-bearing response fields were enumerated. This document reaches all seven of its enums through `allOf: [{ $ref }]` wrappers, so a walk that follows only a bare `$ref` reports zero here and quietly raises `narrowing.recall` — 50 were measured against the pinned digest.',
    ],
  ],
};

export const buildVikunjaTruth = (snapshot: Snapshot): TruthModel =>
  buildSwagger2Truth(snapshot, VIKUNJA_TRUTH);

export const loadVikunjaTruth = (options: { root?: string } = {}): TruthModel =>
  loadSwagger2Truth(VIKUNJA_TRUTH, options);
