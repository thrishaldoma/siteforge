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
  FlowIdSchema,
  RouteIdSchema,
  Sha256Schema,
  SiteIdSchema,
  ViewportSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
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
 * How the crawl authenticated. Credentials never appear here — §3.3 restricts
 * them to `SITEFORGE_USER` / `SITEFORGE_PASS` or the OS keychain.
 */
export const AuthConfigSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('anonymous') }),
  z.strictObject({
    mode: z.literal('storage-state'),
    /** Path only. The file itself is gitignored and chmod 600 (§5). */
    storageStatePath: z.literal('auth/storage-state.json'),
    /** §6: `--auth` launches headful and waits for a hand sign-in. */
    acquiredBy: z.enum(['interactive-headful', 'reused-existing']),
    /** So a run can report "your session expired" rather than silently crawling logged out. */
    expiresAt: z.iso.datetime().nullable(),
    credentialSource: z.enum(['env', 'os-keychain', 'interactive-only']),
  }),
]);

/** §6 crawl frontier limits. */
export const CrawlConfigSchema = z.strictObject({
  maxRoutes: z.int().positive(),
  maxDepth: z.int().nonnegative(),
  /** §5/§6: "a cap of 3 instances per pattern". */
  maxInstancesPerPattern: z.int().positive(),
  sameOriginOnly: z.literal(true),
  allowDestructive: z.boolean(),
  /** Terms the destructive heuristic matches on (§6). */
  destructiveTerms: z.array(z.string().min(1)),
});

/** One URL pattern the crawl found, and which route directories realise it. */
export const RoutePatternSummarySchema = z.strictObject({
  urlPattern: UrlPatternSchema,
  /** Distinct URLs seen for this pattern, before the instance cap was applied. */
  observedUrlCount: z.int().positive(),
  /** Route directories actually written. */
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

  /** §6 setup. `--responsive` adds the second entry. */
  viewports: z.array(ViewportSchema).min(1),
  userAgent: z.string().min(1),
  determinism: DeterminismShimSchema,
  crawl: CrawlConfigSchema,
  auth: AuthConfigSchema,

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
    routes: z.int().nonnegative(),
    patterns: z.int().nonnegative(),
    assets: z.int().nonnegative(),
    endpoints: z.int().nonnegative(),
    flows: z.int().nonnegative(),
    gaps: z.int().nonnegative(),
  }),
});

export type DeterminismShim = z.infer<typeof DeterminismShimSchema>;
export type PermissionBasis = z.infer<typeof PermissionBasisSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;
export type RoutePatternSummary = z.infer<typeof RoutePatternSummarySchema>;
export type CaptureManifest = z.infer<typeof CaptureManifestSchema>;
