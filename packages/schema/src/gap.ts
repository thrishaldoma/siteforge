/**
 * Gaps — the things siteforge could not clone.
 *
 * §1 requires "a `GAPS.md` listing everything that could not be cloned, with each
 * gap explicitly stubbed rather than silently faked", and §7 makes the reason
 * explicit: "A stubbed endpoint returning `501` ... is infinitely more useful in
 * an RL env than a plausible hallucinated one, because a hallucinated endpoint
 * silently corrupts every trajectory that touches it."
 *
 * So a gap is a first-class artifact, not a log line.
 */
import { z } from 'zod';
import {
  AssetIdSchema,
  EndpointIdSchema,
  FlowIdSchema,
  NodeIdSchema,
  RouteIdSchema,
} from './primitives.js';

export const GapIdSchema = z
  .string()
  .regex(/^gap_[0-9a-f]{12}$/, 'expected gap_<12 hex>');

/** Which stage discovered the gap. */
export const StageNameSchema = z.enum(['capture', 'infer', 'codegen', 'verify', 'envkit']);

/**
 * Gap categories.
 *
 * The first block is §11's "Known-hard cases" table, one member per row. The rest
 * cover the cases §6, §7, and §9 name in prose. A capture that needs a category
 * not listed here should add one rather than reach for `unknown` — the point of
 * the enum is that `GAPS.md` can be aggregated and counted.
 */
export const GapCategorySchema = z.enum([
  // §11 table
  'css-in-js-classnames',
  'shadow-dom',
  'iframe-third-party',
  'websocket-interactive',
  'infinite-scroll',
  'oauth-third-party-login',
  'payment-form',
  'bot-protection',
  'licensed-webfont',
  'ab-tested-content',
  // §2 non-goals encountered in the wild
  'canvas-webgl',
  'drm-video',
  'server-side-logic',
  // §6
  'destructive-action-skipped',
  /**
   * A control that leaves the site: another origin, `mailto:`, a download. Not
   * destructive, just not ours to exercise — and no endpoint either way.
   */
  'out-of-scope-control',
  /**
   * A control that was **fired** and would not resolve.
   *
   * Neither declined nor destructive: nothing was refused here, the click was
   * made and the transition did not happen. Added because rung 3 had to file
   * this under `destructive-action-skipped`, which is a false claim about a
   * control whose only problem is that it needs a precondition the crawl did
   * not establish — and §6's whole three-way hazard split exists because one
   * bucket conflating unlike things is how a core auth flow got filed as
   * unreliable. `SkippedControl.cause` already had `precondition-unmet`; this
   * is the gap category that belongs beside it.
   */
  'interaction-not-reproducible',
  'auth-required-not-captured',
  'crawl-limit-reached',
  'asset-fetch-failed',
  // §7
  'low-confidence-inference',
  'unknown-effect-type',
  'endpoint-stubbed',
  /**
   * A field's type was narrowed below what the observations strictly support —
   * an enum or a const. Recorded so every narrowing reaches GAPS.md as a review
   * item; §7's "write a gap, not an invention" applies to a guessed constraint
   * exactly as it applies to a guessed endpoint.
   */
  'inferred-type-narrowed',
  /**
   * A control §6 refused to fire was bound to a URL by static analysis, and the
   * endpoint's behaviour is synthesized from the inferred data model rather than
   * observed. See `synthesized-endpoint` below.
   */
  'endpoint-synthesized',
  // §9
  'visual-gate-cap-reached',
  'behavioral-gate-cap-reached',
]);

/**
 * How the gap was filled in the generated clone.
 *
 * `none` is only legal for `severity: 'info'`. Every gap that affects behavior
 * must name its stub, because §1's contract is "explicitly stubbed rather than
 * silently faked".
 */
export const GapStubSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('http-501'),
    /** §7: stubs are marked on the wire so a trajectory can see it hit one. */
    header: z.literal('X-Siteforge-Stub: true'),
    endpointId: EndpointIdSchema,
  }),
  z.strictObject({ kind: z.literal('static-screenshot'), assetId: AssetIdSchema }),
  z.strictObject({
    kind: z.literal('font-substitute'),
    originalFamily: z.string().min(1),
    substituteFamily: z.string().min(1),
    metricCompatible: z.boolean(),
  }),
  /**
   * §6 never fired the control, so the endpoint's behaviour was never observed —
   * but the clone implements it fully against the mock store anyway.
   *
   * Destructive actions are dangerous against the **target**, not against a local
   * mock: `DELETE /api/account` is free in the clone. A dead button is worse than
   * a working one, because it teaches an agent the control does nothing, and
   * "delete your account" is a legitimate §10 task with a clean state-based
   * validator. The response shape comes from §7.4's inferred data model, which is
   * why this is a gap at all — the shape is derived, not seen.
   */
  z.strictObject({
    kind: z.literal('synthesized-endpoint'),
    endpointId: EndpointIdSchema,
    basis: z.literal('inferred-data-model'),
  }),
  z.strictObject({ kind: z.literal('local-credential-stub'), detail: z.string().min(1) }),
  z.strictObject({ kind: z.literal('scripted-timeline'), frameCount: z.int().nonnegative() }),
  z.strictObject({ kind: z.literal('seeded-pagination'), pagesCaptured: z.int().positive() }),
  z.strictObject({ kind: z.literal('pinned-variant'), variant: z.string().min(1) }),
  z.strictObject({ kind: z.literal('omitted'), detail: z.string().min(1) }),
]);

/** What the gap costs the environment. */
export const GapSeveritySchema = z.enum([
  /** Recorded for completeness; the clone is unaffected. */
  'info',
  /** The clone works but is less faithful. */
  'degraded',
  /** Some task or route cannot be reproduced at all. */
  'blocking',
]);

export const GapSchema = z.strictObject({
  gapId: GapIdSchema,
  stage: StageNameSchema,
  category: GapCategorySchema,
  severity: GapSeveritySchema,
  /** What the gap is about. All fields optional; at least one must be present. */
  subject: z
    .strictObject({
      routeId: RouteIdSchema.optional(),
      nodeId: NodeIdSchema.optional(),
      endpointId: EndpointIdSchema.optional(),
      flowId: FlowIdSchema.optional(),
      assetId: AssetIdSchema.optional(),
      url: z.string().optional(),
    })
    .refine((s) => Object.values(s).some((v) => v !== undefined), {
      message: 'a gap subject must name at least one thing',
    }),
  /** One line, for the GAPS.md table. */
  summary: z.string().min(1).max(200),
  /** Full explanation, including what was tried. */
  detail: z.string().min(1),
  stub: GapStubSchema,
});

export type GapId = z.infer<typeof GapIdSchema>;
export type StageName = z.infer<typeof StageNameSchema>;
export type GapCategory = z.infer<typeof GapCategorySchema>;
export type GapStub = z.infer<typeof GapStubSchema>;
export type GapSeverity = z.infer<typeof GapSeveritySchema>;
export type Gap = z.infer<typeof GapSchema>;
