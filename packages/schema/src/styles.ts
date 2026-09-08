/**
 * `routes/<route-id>/styles.json` — computed styles, deduplicated.
 *
 * §5's load-bearing rule: "A page has thousands of nodes and maybe 200 distinct
 * style objects. Store `styleId` references. This is the difference between a
 * 400MB and a 4MB model."
 *
 * `stats` exists so that claim is *measured* rather than asserted — the fixture
 * suite asserts a real dedupe ratio, and a capture that stops deduplicating fails
 * visibly instead of quietly producing a 400MB model.
 */
import { z } from 'zod';
import {
  AssetIdSchema,
  CssPropertyNameSchema,
  NodeIdSchema,
  RouteIdSchema,
  StyleIdSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';

/**
 * The computed properties siteforge captures.
 *
 * Capturing all ~340 computed properties per node *is* the 400MB problem, so the
 * set is curated to what visual reproduction actually needs. Exported as a const
 * so capture and the visual gate (§9, which diffs "the computed-style delta for
 * the nodes in those regions") compare the same property set.
 */
export const CAPTURED_CSS_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'align-content', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
  'gap', 'row-gap', 'column-gap',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
  'aspect-ratio', 'object-fit', 'object-position',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'background-color', 'background-image', 'background-size', 'background-position',
  'background-repeat', 'background-clip', 'background-origin',
  'color', 'opacity', 'visibility', 'mix-blend-mode', 'filter', 'backdrop-filter',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-stretch',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-decoration-line',
  'text-decoration-color', 'text-decoration-style', 'text-transform', 'text-indent',
  'text-overflow', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap',
  'vertical-align', 'list-style-type', 'list-style-position',
  'overflow-x', 'overflow-y', 'box-shadow',
  'transform', 'transform-origin', 'transition', 'animation',
  'cursor', 'pointer-events', 'user-select', 'content', 'fill', 'stroke', 'stroke-width',
] as const;

/**
 * Which property set a capture used.
 *
 * `siteforge/v1` is CAPTURED_CSS_PROPERTIES above. `full` means every computed
 * property was recorded — legal, but only sane for a single-route debug capture.
 */
export const StylePropertySetSchema = z.enum(['siteforge/v1', 'full']);

/**
 * One computed style object. Keys are CSS property names (custom properties
 * included); values are the resolved computed values as strings, exactly as
 * `getComputedStyle` returns them.
 *
 * Properties still at their initial value may be omitted: a real capture writes
 * only what differs, which is a large part of how the style table stays small.
 *
 * Left as an open record rather than a closed enum of CAPTURED_CSS_PROPERTIES:
 * custom properties are site-defined and unbounded, and `propertySet` already
 * records which curated set was in force.
 */
export const StyleDeclarationSchema = z.record(CssPropertyNameSchema, z.string());

export const StyleTableEntrySchema = z.strictObject({
  styleId: StyleIdSchema,
  declarations: StyleDeclarationSchema,
  /** How many nodes on this route resolve to this entry. Makes orphans detectable. */
  refCount: z.int().positive(),
});

/**
 * An `@font-face` rule read out of the CSSOM (§6).
 *
 * `license` is descriptive only — capture records what it saw. The decision to
 * substitute a metric-compatible open face (§8, §11) belongs to codegen and is
 * recorded there as a gap.
 */
export const FontFaceSchema = z.strictObject({
  family: z.string().min(1),
  sources: z
    .array(
      z.strictObject({
        /** Absent when the font could not be fetched (e.g. blocked by CORS). */
        assetId: AssetIdSchema.optional(),
        originalUrl: z.string().min(1),
        format: z.string().optional(),
      }),
    )
    .min(1),
  weight: z.string().optional(),
  style: z.string().optional(),
  stretch: z.string().optional(),
  display: z.string().optional(),
  unicodeRange: z.string().optional(),
  /** Best-effort detection; `unknown` is the honest default. */
  license: z.enum(['open', 'licensed', 'unknown']).default('unknown'),
});

export const StyleSheetDocumentSchema = z.strictObject({
  ...artifactEnvelope('style-sheet'),
  routeId: RouteIdSchema,
  propertySet: StylePropertySetSchema,
  /** The deduplicated style objects. */
  table: z.array(StyleTableEntrySchema),
  /**
   * **Authoritative** nodeId → styleId mapping. Every element in `dom.json` has
   * exactly one entry.
   *
   * `DomElementNode.styleId` mirrors this for convenient traversal; where the two
   * disagree, this wins, and `RouteCaptureSchema` rejects the disagreement rather
   * than letting it reach codegen.
   */
  assignments: z.record(NodeIdSchema, StyleIdSchema),
  fonts: z.array(FontFaceSchema),
  stats: z.strictObject({
    /**
     * Element nodes carrying an assignment. Text nodes have no computed style,
     * so this is deliberately *not* `dom.json`'s `nodeCount`, which counts every
     * node including text.
     */
    styledNodeCount: z.int().nonnegative(),
    distinctStyles: z.int().nonnegative(),
    /** `distinctStyles / styledNodeCount`. The §5 dedupe claim, as a number. */
    dedupeRatio: z.number().min(0).max(1),
  }),
});

export type CapturedCssProperty = (typeof CAPTURED_CSS_PROPERTIES)[number];
export type StylePropertySet = z.infer<typeof StylePropertySetSchema>;
export type StyleDeclaration = z.infer<typeof StyleDeclarationSchema>;
export type StyleTableEntry = z.infer<typeof StyleTableEntrySchema>;
export type FontFace = z.infer<typeof FontFaceSchema>;
export type StyleSheetDocument = z.infer<typeof StyleSheetDocumentSchema>;
