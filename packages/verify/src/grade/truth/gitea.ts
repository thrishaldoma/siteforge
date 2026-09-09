/**
 * Gitea as a ground truth: the numbers, and nothing about Swagger 2.0.
 *
 * Kept after Vikunja was adopted, and not because it is still the M3 target —
 * it is not (0019: Gitea's browser and Gitea's document are disjoint, so a
 * Gitea *capture* is ungradeable). It is kept because the grader's whole
 * evidence base is the mutation harness running against this snapshot, and
 * that evidence is about the grader rather than about Gitea. Deleting it would
 * throw away 22 demonstrated deltas to tidy up a target nobody will crawl.
 */
import {
  loadSwagger2Truth,
  buildSwagger2Truth,
  type Snapshot,
  type TruthModel,
  type TruthSource,
} from './swagger2.js';

export const GITEA_TRUTH: TruthSource = {
  id: 'gitea',
  specFile: 'swagger.v1.json',
  defaultBasePath: '/api/v1',
  notDerived: [
    {
      category: 'identifier',
      reason:
        'foreign keys derivable from the spec — this truth side is not derived (0015 modality table)',
    },
  ],
  /**
   * Measured surface: 308 paths, 482 operations, 13 public / 37 gated
   * zero-parameter GETs. Every floor sits far below what was measured.
   */
  floors: (counts, endpoints) => [
    [counts.operations >= 100, `only ${counts.operations} operations loaded; the pinned image serves 482`],
    [counts.withPathParams >= 50, `only ${counts.withPathParams} operations carry a path parameter`],
    [counts.definitions >= 50, `only ${counts.definitions} definitions loaded`],
    [
      counts.authRequired >= 5,
      `the auth truth has ${counts.authRequired} gated endpoints — the anonymous sweep did not run`,
    ],
    [
      counts.authNotRequired >= 5,
      `the auth truth has ${counts.authNotRequired} public endpoints. The over-gate denominator would be zero, which §6 scores vacuous and fails — and it would score infer wrong for correctly observing a public read.`,
    ],
    [
      endpoints.some((e) => e.responseFields.length > 0),
      'no response fields were enumerated; $ref resolution is broken',
    ],
    [
      endpoints.some((e) => e.requestFields.length > 0),
      'no request fields were enumerated; body parameters are not being read',
    ],
  ],
};

export const buildGiteaTruth = (snapshot: Snapshot): TruthModel =>
  buildSwagger2Truth(snapshot, GITEA_TRUTH);

export const loadGiteaTruth = (options: { root?: string } = {}): TruthModel =>
  loadSwagger2Truth(GITEA_TRUTH, options);
