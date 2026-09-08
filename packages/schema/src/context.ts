/**
 * Capture contexts.
 *
 * A context is the set of browser-level conditions a route was captured under.
 * §6 already needs two of them ("Crawl authenticated and anonymous route sets
 * separately", plus `--responsive`'s second viewport), and §11 adds a third
 * ("A/B tested content — pin one variant, record that you did").
 *
 * These behave identically: each multiplies the capture set, each is declared
 * once for the whole crawl, and each must be recoverable from a route's identity.
 * Modelling them as one thing means adding locale or a second variant later is
 * *declaring a context*, not editing `RouteIdSchema` — which is what happened the
 * first two times, and is why viewport ended up hardcoded into an id regex.
 *
 * See docs/decisions/0004-capture-context.md.
 */
import { z } from 'zod';
import { ContextIdSchema, ViewportSchema } from './primitives.js';

/**
 * Locale conditions. Both affect rendering, and both must be pinned for the
 * determinism §8 requires — a page that formats dates client-side renders
 * differently in two timezones.
 */
export const LocaleSchema = z.strictObject({
  /** BCP-47, e.g. `en-US`. */
  language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'expected a BCP-47 tag'),
  /** IANA zone, e.g. `UTC` or `Europe/Berlin`. */
  timezone: z.string().min(1),
});

/**
 * §11: "A/B tested content — Pin one variant, record that you did."
 *
 * `pinnedBy` is how the variant was forced, so a re-crawl can reproduce it and a
 * reader can tell a deliberate pin from a lucky draw.
 */
export const VariantPinSchema = z.strictObject({
  experiment: z.string().min(1),
  variant: z.string().min(1),
  pinnedBy: z.enum(['cookie', 'query-param', 'header', 'local-storage', 'observed-only']),
  /**
   * True when siteforge could not force the variant and simply recorded the one
   * it was served. A re-crawl may differ; pair with a gap.
   */
  bestEffort: z.boolean(),
});

/**
 * Authentication conditions.
 *
 * Credentials never appear here (§3.3) — only the mechanism, so a later run can
 * decide whether the stored session is still usable.
 */
export const AuthContextSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('anonymous') }),
  z.strictObject({
    mode: z.literal('storage-state'),
    /** Path only. The file is gitignored and chmod 600 (§5). */
    storageStatePath: z.string().regex(/^auth\/[A-Za-z0-9._-]+\.json$/, 'expected auth/<name>.json'),
    /** §6: `--auth` launches headful and waits for a hand sign-in. */
    acquiredBy: z.enum(['interactive-headful', 'reused-existing']),
    expiresAt: z.iso.datetime().nullable(),
    credentialSource: z.enum(['env', 'os-keychain', 'interactive-only']),
  }),
]);

export const CaptureContextSchema = z.strictObject({
  /**
   * Stable slug naming the combination, e.g. `anon-desktop`, `auth-mobile`.
   * Appears verbatim in every `routeId` captured under it.
   */
  contextId: ContextIdSchema,
  /** Human-facing one-liner for the CLI digest and GAPS.md. */
  label: z.string().min(1),
  auth: AuthContextSchema,
  viewport: ViewportSchema,
  locale: LocaleSchema,
  /** Null when the site served no experiment, or none was found. */
  variant: VariantPinSchema.nullable(),
});

export type Locale = z.infer<typeof LocaleSchema>;
export type VariantPin = z.infer<typeof VariantPinSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
export type CaptureContext = z.infer<typeof CaptureContextSchema>;
