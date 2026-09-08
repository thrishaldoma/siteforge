/**
 * `routes/<route-id>/meta.json` — identity and provenance of one captured route.
 *
 * §5: "url, url-pattern, title, status, template-guess".
 *
 * `routeId` is the composite capture key (pattern + context + instance), settled
 * in docs/decisions/0002 and revised by 0004. `urlPattern` is the *grouping* key —
 * §5's "URL patterns, not URLs. Route identity is the pattern" holds as a field,
 * so §7.3's route templating groups on `urlPattern` and gets every instance in
 * every context.
 */
import { z } from 'zod';
import {
  AbsoluteUrlSchema,
  ContextIdSchema,
  NodeIdSchema,
  RectSchema,
  RouteIdSchema,
  Sha256Schema,
  SiteIdSchema,
  SlugSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { GapIdSchema } from './gap.js';

/**
 * A URL pattern with named parameters, e.g. `/product/:id` or `/blog/:year/:slug`.
 * Always begins with `/`; never carries a query string or fragment.
 */
export const UrlPatternSchema = z
  .string()
  .regex(/^\/(?:[A-Za-z0-9\-._~%]+|:[a-z][A-Za-z0-9]*)?(?:\/(?:[A-Za-z0-9\-._~%]+|:[a-z][A-Za-z0-9]*))*\/?$/,
    'expected a path pattern like /product/:id');

/** A screenshot on disk, content-addressed so re-crawls can be compared. */
export const ScreenshotRefSchema = z.strictObject({
  /** Relative to the route directory, e.g. `shot.full.png`. */
  path: z.string().min(1),
  sha256: Sha256Schema,
  width: z.int().positive(),
  height: z.int().positive(),
});

/** One frame of §6's scroll pass, stepped in 0.5-viewport increments. */
export const ScrollShotSchema = z.strictObject({
  /** Matches `StateDelta`'s `scrollStep` and the `NNNN` in `scroll/NNNN.png`. */
  index: z.int().nonnegative(),
  scrollY: z.number().nonnegative(),
  shot: ScreenshotRefSchema,
});

/**
 * §7.3 grouping hint produced during capture, refined during infer.
 *
 * Carries confidence and rationale rather than a bare name, because §7's rule is
 * that low confidence becomes a gap rather than an invention — a downstream stage
 * cannot apply that rule to a guess that does not report its own certainty.
 */
export const TemplateGuessSchema = z.strictObject({
  name: SlugSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

/**
 * What an anonymous visitor gets for a route that requires auth.
 *
 * §6: "record which routes require which, because the clone must reproduce the
 * redirect-to-login behavior." Recorded as a field on the authenticated capture
 * rather than as a second route directory, so the auth axis does not join the
 * route id.
 */
export const UnauthenticatedBehaviorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('accessible') }),
  z.strictObject({
    kind: z.literal('redirect'),
    to: z.string().min(1),
    status: z.int().min(300).max(399),
  }),
  z.strictObject({ kind: z.literal('status'), status: z.int().min(400).max(599) }),
  z.strictObject({ kind: z.literal('empty-shell') }),
]);

/**
 * Whether this route directory holds artifacts or points at another that does.
 *
 * Contexts multiply captures, but most routes render identically across them — a
 * marketing page is the same logged in and out. Storing it once per context is
 * pure waste in an artifact set §5 already works hard to keep small.
 *
 * `contentHash` is `deriveRouteContentHash({dom, styles, states})`: the rendered
 * content with `routeId` and `provenance` stripped, so two contexts that produced
 * the same page agree on it. A `shared` route writes only `meta.json`.
 */
export const RouteContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('captured'),
    contentHash: Sha256Schema,
    /**
     * The box this document actually rendered into. Equals the context's viewport
     * for a top-level route; equals the frame's content box for an embed.
     */
    renderedSize: z.strictObject({
      width: z.int().positive(),
      height: z.int().positive(),
    }),
    screenshots: z.strictObject({
      full: ScreenshotRefSchema,
      /** §6: 0.5-viewport increments to the bottom. Empty when the page does not scroll. */
      scroll: z.array(ScrollShotSchema),
    }),
    pageMetrics: z.strictObject({
      scrollHeight: z.number().nonnegative(),
      scrollWidth: z.number().nonnegative(),
      /** Number of 0.5-viewport steps taken. */
      scrollSteps: z.int().nonnegative(),
    }),
  }),
  z.strictObject({
    kind: z.literal('shared'),
    contentHash: Sha256Schema,
    /** The route that stores the artifacts. Must itself be `captured`. */
    canonicalRouteId: RouteIdSchema,
  }),
]);

export const RouteMetaSchema = z.strictObject({
  ...artifactEnvelope('route-meta'),
  routeId: RouteIdSchema,
  siteId: SiteIdSchema,

  /** Grouping key. Every instance of this template, in every context, shares it. */
  urlPattern: UrlPatternSchema,
  /**
   * The conditions this capture was taken under. Resolves against
   * `manifest.contexts`; `CaptureModelSchema` rejects an unknown one.
   */
  contextId: ContextIdSchema,
  /** Which of the (up to `budget.maxInstancesPerPattern`) observed URLs this is. */
  instanceIndex: z.int().nonnegative(),

  /** The concrete URL crawled, post-scrub. */
  url: AbsoluteUrlSchema,
  /** Values bound to the pattern's parameters, e.g. `{ id: 'mug-blue-12oz' }`. */
  pathParams: z.record(z.string(), z.string()),
  canonicalUrl: AbsoluteUrlSchema.nullable(),
  title: z.string(),
  status: z.int().min(100).max(599),
  redirectChain: z.array(
    z.strictObject({
      from: AbsoluteUrlSchema,
      to: AbsoluteUrlSchema,
      status: z.int().min(300).max(399),
    }),
  ),

  templateGuess: TemplateGuessSchema,

  /**
   * Whether the *route* is gated — a property of the site, not of the context it
   * happened to be captured under. `manifest.contexts[contextId].auth` says which
   * state the crawler was in.
   */
  requiresAuth: z.boolean(),
  unauthenticatedBehavior: UnauthenticatedBehaviorSchema,

  /** BFS depth from the entry URL (§6 crawl frontier). */
  depth: z.int().nonnegative(),
  /** How the crawler reached this route. */
  discoveredFrom: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('entry') }),
    z.strictObject({
      kind: z.literal('link'),
      routeId: RouteIdSchema,
      nodeId: NodeIdSchema,
    }),
    z.strictObject({ kind: z.literal('redirect'), routeId: RouteIdSchema }),
    z.strictObject({ kind: z.literal('iframe'), routeId: RouteIdSchema, nodeId: NodeIdSchema }),
  ]),

  /**
   * Non-empty when this route is a same-origin iframe recursed into as a nested
   * route (§11). One entry per parent frame that embedded it.
   *
   * An embedded route inherits its parent's context; the frame's content box is
   * recorded as `content.renderedSize` rather than as a capture condition, since
   * a frame box is a property of the embed and not of the crawl.
   */
  embeddedIn: z.array(
    z.strictObject({
      routeId: RouteIdSchema,
      /** The `<iframe>` element in the parent's `dom.json`. */
      nodeId: NodeIdSchema,
      contentBox: RectSchema,
    }),
  ),

  content: RouteContentSchema,

  gapIds: z.array(GapIdSchema),
});

export type RouteContent = z.infer<typeof RouteContentSchema>;
export type UrlPattern = z.infer<typeof UrlPatternSchema>;
export type ScreenshotRef = z.infer<typeof ScreenshotRefSchema>;
export type ScrollShot = z.infer<typeof ScrollShotSchema>;
export type TemplateGuess = z.infer<typeof TemplateGuessSchema>;
export type UnauthenticatedBehavior = z.infer<typeof UnauthenticatedBehaviorSchema>;
export type RouteMeta = z.infer<typeof RouteMetaSchema>;
