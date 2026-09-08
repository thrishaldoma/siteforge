/**
 * Shared scalar types. Everything else in the contract is built from these.
 *
 * The regexes are deliberately narrow. An id that can be "any string" is an id
 * that will silently absorb a bug from the stage that produced it, and the whole
 * point of §13 ("schema drift between stages is the failure mode that will cost
 * you the most time") is to make that impossible.
 */
import { z } from 'zod';

/** Content address of a captured byte stream. Lowercase hex, 64 chars. */
export const Sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a lowercase hex sha256');

/** Truncated hash used for structural fingerprints where 64 chars is noise. */
export const ShortHashSchema = z
  .string()
  .regex(/^[0-9a-f]{16}$/, 'expected 16 lowercase hex chars');

/** ISO-8601 instant, always UTC. */
export const IsoTimestampSchema = z.iso.datetime();

/** Absolute URL, as observed on the wire. */
export const AbsoluteUrlSchema = z.url();

/** Lowercase kebab slug. The alphabet for every human-facing id in the model. */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lowercase kebab-case slug');

/** Identifies one cloned site: the directory name under `capture/`. */
export const SiteIdSchema = SlugSchema;

/**
 * Identifies one capture context: the browser conditions a route was captured
 * under (auth, viewport, locale, pinned variant). Declared once in the manifest,
 * referenced by every routeId. See `./context.js`.
 */
export const ContextIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'expected a lowercase kebab-case context id');

/**
 * Identifies one captured route artifact directory.
 *
 * Composite key: `<pattern-slug>--<context-id>--i<instance>`
 * See docs/decisions/0002 and 0004.
 *
 * The context is a *reference*, not an encoding — adding locale or a pinned
 * variant declares a new context rather than widening this id. That is the whole
 * point: an earlier version spelled the viewport into the id as `1280x800`, which
 * made every new capture dimension a schema change.
 *
 * One URL pattern yields up to `budget.maxInstancesPerPattern` of these *per
 * context*. The pattern lives in `RouteMeta.urlPattern`, which is the grouping
 * key — "route identity is the pattern" (§5) survives as a field.
 *
 * e.g. `product-id--anon-desktop--i1`
 */
export const RouteIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*--i\d+$/,
    'expected <pattern-slug>--<context-id>--i<instance>',
  );

/**
 * Identifies one DOM node, stably across re-crawls.
 *
 * §5: "Derive from a structural path hash (`tag[nth-of-type]/...`) plus a content
 * fingerprint, not from DOM order alone. They must survive re-crawls so diffs are
 * meaningful."
 *
 * The two inputs are stored alongside the id on every element (`NodeIdentity`)
 * so that when an id *does* change between crawls, the diff can say which half
 * moved — structure or content.
 */
export const NodeIdSchema = z
  .string()
  .regex(/^n_[0-9a-f]{16}$/, 'expected n_<16 hex>');

/** Identifies one deduplicated computed-style object within a route's style table. */
export const StyleIdSchema = z
  .string()
  .regex(/^s_[0-9a-f]{16}$/, 'expected s_<16 hex>');

/** Identifies one recorded interaction flow (`flows/<flow-id>.trace.json`). */
export const FlowIdSchema = SlugSchema;

/** Identifies one normalized HTTP endpoint in `network/endpoints.json`. */
export const EndpointIdSchema = SlugSchema;

/** Identifies one captured asset. Always the sha256 of its bytes. */
export const AssetIdSchema = Sha256Schema;

/**
 * Identifies a node in the accessibility tree.
 *
 * §10: "Refs are stable IDs from the a11y tree, not CSS selectors — selectors
 * break the moment the agent causes a re-render." The same ref scheme is used at
 * capture time and at runtime so the recorded flows address the same things the
 * agent's action space does.
 */
export const A11yRefSchema = z
  .string()
  .regex(/^a11y_[0-9a-f]{12}$/, 'expected a11y_<12 hex>');

/** A CSS property name, including custom properties. */
export const CssPropertyNameSchema = z
  .string()
  .regex(
    /^(?:--[A-Za-z0-9_-]+|-{0,1}[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/,
    'expected a CSS property name',
  );

/** Viewport the page was rendered at. Part of the route capture key. */
export const ViewportSchema = z.strictObject({
  width: z.int().positive(),
  height: z.int().positive(),
  deviceScaleFactor: z.number().positive(),
  isMobile: z.boolean(),
  hasTouch: z.boolean(),
});

/** Layout rectangle in CSS pixels, relative to the document origin. */
export const RectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const HttpMethodSchema = z.enum([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

export type Sha256 = z.infer<typeof Sha256Schema>;
export type ShortHash = z.infer<typeof ShortHashSchema>;
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
export type AbsoluteUrl = z.infer<typeof AbsoluteUrlSchema>;
export type Slug = z.infer<typeof SlugSchema>;
export type SiteId = z.infer<typeof SiteIdSchema>;
export type ContextId = z.infer<typeof ContextIdSchema>;
export type RouteId = z.infer<typeof RouteIdSchema>;
export type NodeId = z.infer<typeof NodeIdSchema>;
export type StyleId = z.infer<typeof StyleIdSchema>;
export type FlowId = z.infer<typeof FlowIdSchema>;
export type EndpointId = z.infer<typeof EndpointIdSchema>;
export type AssetId = z.infer<typeof AssetIdSchema>;
export type A11yRef = z.infer<typeof A11yRefSchema>;
export type CssPropertyName = z.infer<typeof CssPropertyNameSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type Rect = z.infer<typeof RectSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
