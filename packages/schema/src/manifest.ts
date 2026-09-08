/**
 * `manifest.json` — everything needed to reproduce the crawl.
 *
 * §5: "target, timestamp, viewport, UA, seed, siteforge version". Expanded to the
 * full set of inputs §6 makes the capture depend on, because a manifest that does
 * not pin every input cannot support M1's "recrawl is idempotent modulo
 * timestamps" — the timestamp is volatile and lives in `provenance`; everything
 * here is an input and must be stable.
 *
 * Nothing in this file may carry a credential (§3.3). `auth` records the
 * *mechanism*, never a username, password, cookie, or token.
 */
import { z } from 'zod';
import {
  AbsoluteUrlSchema,
  ContextIdSchema,
  FlowIdSchema,
  RouteIdSchema,
  Sha256Schema,
  SiteIdSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import {
  CaptureContextSchema,
  SessionProbePolicySchema,
  deriveSessionProbePolicy,
} from './context.js';
import { UrlPatternSchema } from './route.js';

/**
 * The determinism shim §6 injects before any page script.
 *
 * "Inject a shim before any page script that freezes `Date.now`,
 * `performance.now`, `Math.random`, and `crypto.randomUUID` against the run seed
 * — you need this here as well as in the clone, or your 'identical' recrawls will
 * never be identical."
 *
 * Recorded so the clone's `lib/determinism.ts` (§8) can be seeded identically.
 */
export const DeterminismShimSchema = z.strictObject({
  seed: z.int().nonnegative(),
  /** The fixed value `Date.now()` returns, as epoch milliseconds. */
  frozenEpochMs: z.int().nonnegative(),
  frozenTimezone: z.string().min(1),
  frozenLocale: z.string().min(1),
  /** Globals the shim replaced. All four of §6's are required. */
  frozen: z
    .array(z.enum(['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID']))
    .min(4),
  prefersReducedMotion: z.literal('reduce'),
});

/** §3.1: siteforge refuses to run unless permission is asserted. */
export const PermissionBasisSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('allowlist'),
    /** The line in `allowlist.txt` that matched. */
    matchedEntry: z.string().min(1),
  }),
  z.strictObject({
    source: z.literal('cli-flag'),
    flag: z.literal('--i-have-permission'),
    /**
     * The text the CLI printed describing what the flag asserts, recorded so the
     * artifact carries the assertion, not just the fact that one was made.
     * Deliberately no operator identity: that would be PII in a capture artifact.
     */
    assertionText: z.string().min(1),
  }),
]);

/**
 * §6 crawl frontier limits, made context-aware.
 *
 * Contexts multiply captures: N contexts over one site is up to N times the
 * routes. §6's caps are therefore *per context*, with a global ceiling so a run
 * that declares six contexts cannot quietly cost six times as much.
 */
export const CrawlBudgetSchema = z
  .strictObject({
    /** §5/§6: "a cap of 3 instances per pattern" — now per (pattern, context). */
    maxInstancesPerPattern: z.int().positive(),
    /** §6's `--max-routes` (default 40), applied within each context. */
    maxRoutesPerContext: z.int().positive(),
    /** Hard ceiling across every context. What stops contexts multiplying without bound. */
    maxRoutesTotal: z.int().positive(),
    maxDepth: z.int().nonnegative(),
  })
  .refine((b) => b.maxRoutesTotal >= b.maxRoutesPerContext, {
    message: 'maxRoutesTotal must be at least maxRoutesPerContext',
    path: ['maxRoutesTotal'],
  });

export const CrawlConfigSchema = z.strictObject({
  budget: CrawlBudgetSchema,
  sameOriginOnly: z.literal(true),
  /**
   * Origins a main-frame navigation may reach. The crawl's own origin, plus
   * anything the operator explicitly permitted (an auth provider, say).
   *
   * One source, consulted at one chokepoint. §6 was "same-origin only" enforced
   * by not *following* off-origin links, which a control calling `window.open`
   * walks straight past — and §6's behaviour probing clicks controls.
   */
  allowedOrigins: z.array(z.string().min(1)).min(1),
  allowDestructive: z.boolean(),
  /**
   * Whether session-destructive probing was unrestricted, and therefore what
   * coverage was achievable at all. Recomputed from the contexts below: a
   * coverage invariant must not hold an interactive capture to a credentialed
   * one's standard.
   */
  sessionProbePolicy: SessionProbePolicySchema,
  /** Terms the destructive heuristic matches on (§6). */
  destructiveTerms: z.array(z.string().min(1)),
});

/** One URL pattern the crawl found, and which route directories realise it. */
export const RoutePatternSummarySchema = z.strictObject({
  urlPattern: UrlPatternSchema,
  /** Distinct URLs seen for this pattern, before the instance cap was applied. */
  observedUrlCount: z.int().positive(),
  /** Route directories actually written, across every context. */
  routeIds: z.array(RouteIdSchema).min(1),
});

export const CaptureManifestSchema = z.strictObject({
  ...artifactEnvelope('capture-manifest'),
  siteId: SiteIdSchema,

  target: z.strictObject({
    entryUrl: AbsoluteUrlSchema,
    /** Scheme + host + port. The same-origin boundary for the crawl. */
    origin: z.string().min(1),
  }),
  permission: PermissionBasisSchema,

  /**
   * Every set of conditions the site was captured under (§6's anonymous and
   * authenticated sets, `--responsive`'s viewports, §11's pinned variants).
   *
   * Adding a capture dimension means adding a context here — never widening
   * `RouteIdSchema`. See docs/decisions/0004.
   */
  contexts: z.array(CaptureContextSchema).min(1),
  userAgent: z.string().min(1),
  determinism: DeterminismShimSchema,
  crawl: CrawlConfigSchema,

  /** Pinned so a re-crawl on a different Chromium is not mistaken for a real diff. */
  toolVersions: z.strictObject({
    siteforge: z.string().min(1),
    playwright: z.string().min(1),
    browser: z.string().min(1),
  }),

  /** Index of what this capture contains. */
  patterns: z.array(RoutePatternSummarySchema),
  routeIds: z.array(RouteIdSchema),
  flowIds: z.array(FlowIdSchema),

  /**
   * Hash over every *content* artifact — routes, assets, endpoints, flows —
   * each canonicalised with `provenance` stripped, in sorted path order.
   *
   * Excludes `manifest.json` and `stage-report.json`, which describe the run
   * rather than the site; including either would make the hash self-referential.
   *
   * This single value is M1's idempotency check: two crawls of an unchanged site
   * agree here, or they do not.
   */
  contentHash: Sha256Schema,

  counts: z.strictObject({
    contexts: z.int().positive(),
    /** Route directories written, including shared-content pointers. */
    routes: z.int().nonnegative(),
    /** Directories that actually hold artifacts. The rest point at these. */
    capturedRoutes: z.int().nonnegative(),
    patterns: z.int().nonnegative(),
    assets: z.int().nonnegative(),
    endpoints: z.int().nonnegative(),
    flows: z.int().nonnegative(),
    gaps: z.int().nonnegative(),
  }),
}).superRefine((manifest, ctx) => {
  // Derived field, recomputed (decision 0011). The policy governs what probing
  // was possible, so a manifest that misreports it would have a coverage
  // invariant judge an interactive capture by a credentialed one's standard.
  const derived = deriveSessionProbePolicy(manifest.contexts);
  if (derived !== manifest.crawl.sessionProbePolicy) {
    ctx.addIssue({
      code: 'custom',
      path: ['crawl', 'sessionProbePolicy'],
      message:
        `claims '${manifest.crawl.sessionProbePolicy}' but the declared contexts imply '${derived}'`,
    });
  }
  // The crawl's own origin is always navigable; a manifest that omits it is
  // describing a boundary the crawl could not have run inside.
  if (!manifest.crawl.allowedOrigins.includes(manifest.target.origin)) {
    ctx.addIssue({
      code: 'custom',
      path: ['crawl', 'allowedOrigins'],
      message: `must include the target origin ${manifest.target.origin}`,
    });
  }
});

export type DeterminismShim = z.infer<typeof DeterminismShimSchema>;
export type PermissionBasis = z.infer<typeof PermissionBasisSchema>;
export type CrawlBudget = z.infer<typeof CrawlBudgetSchema>;
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;
export type RoutePatternSummary = z.infer<typeof RoutePatternSummarySchema>;
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;
