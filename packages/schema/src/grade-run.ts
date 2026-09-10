/**
 * `grade-run.json` — one grading, on disk, with the instance it was about
 * (decision 0053).
 *
 * The grader has always printed to a console. Every comparison in this
 * repository's record was therefore made by a human reading two terminal
 * scrollbacks — which is exactly where a seed change is invisible, and 0051 is
 * what that costs: a metric table with a `before` and an `after` column whose
 * two halves describe two different Vikunjas.
 *
 * So the report is persisted, it carries `seedState`, and a comparison across
 * two of them is a gate that can refuse rather than a reader's judgement.
 *
 * **A subset of what the grader computes, deliberately.** The matching detail,
 * the auth breakdown and the entity alignment stay in the console render. What
 * is persisted is what a comparison reads: the identity, and every metric's
 * numerator and denominator. Persisting the rest would be a second copy of a
 * derived value, which §13 says drifts — one side computes, the other
 * references.
 */
import { z } from 'zod';
import { GradeCategoryIdSchema, GradeSuiteIdSchema } from './grade-contract.js';
import { ProvenanceSchema } from './artifact.js';
import { Sha256Schema, SiteIdSchema } from './primitives.js';
import { SeedStateSchema } from './seed-state.js';

/**
 * One metric, as persisted.
 *
 * `numerator` and `denominator` are the point of the file. 0051 §4.2 measured a
 * rate rising 0.9000 → 0.9433 with its miss count byte-identical at 25, on a
 * denominator that went 250 → 441 — a gate cleared entirely by growth. A report
 * that carried only `value` could not have shown that, and did not.
 */
export const GradeRunMetricSchema = z.strictObject({
  id: z.string().min(1),
  suite: GradeSuiteIdSchema,
  category: GradeCategoryIdSchema,
  kind: z.enum(['rate', 'count']),
  numerator: z.number().nonnegative(),
  denominator: z.number().nonnegative(),
  /** `null` when vacuous. Never 1.0 from an empty denominator (0015 §6). */
  value: z.number().nullable(),
  vacuous: z.boolean(),
  gate: z
    .strictObject({
      kind: z.enum(['structural', 'calibration']),
      direction: z.enum(['atLeast', 'atMost']),
      value: z.number(),
    })
    .nullable(),
  passed: z.boolean(),
  /**
   * Set where the metric is a conservation check rather than a measurement.
   *
   * Carried into the comparison because a conservation check *moving* means
   * something different from a rate improving: it means the one defect that
   * can move it happened.
   */
  conservation: z.string().min(1).optional(),
});

export const GradeRunSchema = z.strictObject({
  artifact: z.literal('grade-run'),
  provenance: ProvenanceSchema,
  siteId: SiteIdSchema,
  /**
   * The instance the graded capture was taken against.
   *
   * Not the grader's own input — the *capture's*, read from `manifest.json`. A
   * grade report that derived this from anywhere else would be describing the
   * grading rather than the thing graded.
   */
  seedState: SeedStateSchema,
  /** Which contract produced these numbers. Two versions are two definitions. */
  metricsVersion: z.int().positive(),
  contractDigest: Sha256Schema,
  metrics: z.array(GradeRunMetricSchema).min(1),
  passed: z.boolean(),
  failedCategories: z.array(GradeCategoryIdSchema),
});

export type GradeRunMetric = z.infer<typeof GradeRunMetricSchema>;
export type GradeRun = z.infer<typeof GradeRunSchema>;
