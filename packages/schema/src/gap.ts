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
  'auth-required-not-captured',
  'crawl-limit-reached',
  'asset-fetch-failed',
  // §7
  'low-confidence-inference',
  'unknown-effect-type',
  'endpoint-stubbed',
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
