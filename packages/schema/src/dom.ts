/**
 * `routes/<route-id>/dom.json` — the normalized DOM tree.
 *
 * "Normalized" is defined, not vibes: see `DomNormalizationSchema`. The tree is
 * not source HTML (§2: "Byte-identical HTML" is a non-goal). It is the rendered
 * structure, with the parts that cannot survive a re-crawl removed.
 */
import { z } from 'zod';
import {
  A11yRefSchema,
  NodeIdSchema,
  RectSchema,
  RouteIdSchema,
  ShortHashSchema,
  StyleIdSchema,
  AbsoluteUrlSchema,
  AssetIdSchema,
  type NodeId,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { GapIdSchema } from './gap.js';

/**
 * Attribute stamped on flattened shadow content.
 *
 * §11: shadow DOM is pierced and "flatten[ed] with a marker attribute". Exported
 * so capture (which writes it) and codegen (which must reproduce or strip it)
 * cannot disagree about the spelling.
 */
export const SHADOW_MARKER_ATTRIBUTE = 'data-siteforge-shadow';

/** How this element was found to be interactive (§6, interaction discovery). */
export const DiscoverySourceSchema = z.enum([
  /** `page.accessibility.snapshot()` role is one of the interactive roles. */
  'a11y-tree',
  /** CDP `DOMDebugger.getEventListeners` reported a handler. Catches clickable divs. */
  'event-listeners',
  /** Matched by a pseudo-class rule extracted from the CSSOM. */
  'pseudo-class-rule',
  /** Computed `cursor: pointer`. */
  'cursor-pointer',
]);

/**
 * The per-element record §6 requires for every interaction candidate:
 * "bounding box, a11y role and name, a stable selector, and whether a state
 * delta was observed."
 *
 * Bounding box lives on the element itself; role and name live in `a11y`.
 */
export const InteractionCandidateSchema = z.strictObject({
  discoveredBy: z.array(DiscoverySourceSchema).min(1),
  /**
   * A selector that re-resolves this element on a fresh load. Used for capture-time
   * replay only. Runtime addressing uses `a11y.ref` (§10) because selectors do not
   * survive a re-render.
   */
  selector: z.string().min(1),
  /** Event types reported by CDP, e.g. `['click', 'keydown']`. */
  eventTypes: z.array(z.string()).default([]),
  /** Whether behavior probing (§6) actually observed a state change. */
  stateDeltaObserved: z.boolean(),
  /**
   * Set when the destructive-action heuristic (§6) matched. `skipped: true` means
   * no probe was run and a gap was written.
   */
  destructive: z
    .strictObject({
      matchedTerm: z.string().min(1),
      skipped: z.boolean(),
    })
    .optional(),
});

/**
 * The three components of a node's identity, retained so a changed id can be
 * attributed rather than merely noticed.
 *
 * `nodeId = hash(structuralPath | semanticKey)`. `contentFingerprint` is recorded
 * but deliberately **excluded** from the id: on a live site prices, timestamps
 * and counts churn between crawls, and folding them in would relocate every node
 * beneath them. Two crawls agreeing on `nodeId` and differing here means "same
 * node, new content", which is the distinction §5 wants diffs to make.
 *
 * See docs/decisions/0005-nodeid-is-structural-not-content.md.
 */
export const NodeIdentitySchema = z.strictObject({
  /** e.g. `html/body/div[2]/main[1]/ul[1]/li[3]` */
  structuralPath: z.string().min(1),
  /** Authored, data-independent attributes. Framework-generated ids excluded. */
  semanticKey: ShortHashSchema,
  /** The node's own text and content-bearing attributes. Not part of `nodeId`. */
  contentFingerprint: ShortHashSchema,
});

/** §11: same-origin iframes recurse into a nested route; third-party ones are stubbed. */
export const IframeRefSchema = z.discriminatedUnion('sameOrigin', [
  z.strictObject({
    sameOrigin: z.literal(true),
    src: AbsoluteUrlSchema,
    /** The nested route this iframe was captured as. */
    routeId: RouteIdSchema,
  }),
  z.strictObject({
    sameOrigin: z.literal(false),
    src: AbsoluteUrlSchema,
    /** Static screenshot standing in for the third-party frame (§11). */
    placeholderAssetId: AssetIdSchema,
    /** Always paired with a gap. */
    gapId: GapIdSchema,
  }),
]);

/**
 * Shadow root marker.
 *
 * §11 pierces shadow roots and flattens their content inline. An **open** root
 * yields its content. A **closed** root does not: `element.shadowRoot` is `null`
 * from page context by design, and there is no supported way to reach inside one.
 * That is a permanent capability gap, not a missing feature, so a closed root
 * always carries the gap it wrote.
 */
export const ShadowHostSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('open') }),
  z.strictObject({ mode: z.literal('closed'), gapId: GapIdSchema }),
]);

export type ShadowHost = z.infer<typeof ShadowHostSchema>;
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;
export type InteractionCandidate = z.infer<typeof InteractionCandidateSchema>;
export type NodeIdentity = z.infer<typeof NodeIdentitySchema>;
export type IframeRef = z.infer<typeof IframeRefSchema>;

export interface DomElementNode {
  nodeType: 'element';
  nodeId: NodeId;
  identity: NodeIdentity;
  /** Lowercased tag name. Custom elements keep their hyphenated name. */
  tag: string;
  /**
   * Attributes as rendered, post-scrub.
   *
   * `class` is retained for debugging only. §11 is explicit that CSS-in-JS
   * classnames are hashed and unstable, so `styleId` — not `class` — is the
   * authoritative style reference for every consumer.
   */
  attributes: Record<string, string>;
  /**
   * Index into this route's style table. Mirrors `styles.json`'s `assignments`,
   * which is authoritative; `RouteCaptureSchema` enforces that they agree.
   */
  styleId: string;
  a11y?: { ref: string; role: string; name: string } | undefined;
  boundingBox?: z.infer<typeof RectSchema> | undefined;
  interaction?: InteractionCandidate | undefined;
  /**
   * Present on a shadow host. An open root's content is flattened inline into
   * `children`; a closed root's cannot be reached, so `children` is empty and a
   * gap is named.
   */
  shadowHost?: { mode: 'open' } | { mode: 'closed'; gapId: string } | undefined;
  /** Present on flattened shadow content; points at the host. */
  withinShadowRootOf?: NodeId | undefined;
  iframe?: IframeRef | undefined;
  children: DomNode[];
}

export interface DomTextNode {
  nodeType: 'text';
  nodeId: NodeId;
  /** Whitespace-collapsed, scrubbed text content. */
  value: string;
}

export type DomNode = DomElementNode | DomTextNode;

export const DomNodeSchema: z.ZodType<DomNode> = z.lazy(() =>
  z.discriminatedUnion('nodeType', [
    z.strictObject({
      nodeType: z.literal('element'),
      nodeId: NodeIdSchema,
      identity: NodeIdentitySchema,
      tag: z.string().regex(/^[a-z][a-z0-9-]*$/, 'expected a lowercase tag name'),
      attributes: z.record(z.string(), z.string()),
      styleId: StyleIdSchema,
      a11y: z
        .strictObject({ ref: A11yRefSchema, role: z.string().min(1), name: z.string() })
        .optional(),
      boundingBox: RectSchema.optional(),
      interaction: InteractionCandidateSchema.optional(),
      shadowHost: ShadowHostSchema.optional(),
      withinShadowRootOf: NodeIdSchema.optional(),
      iframe: IframeRefSchema.optional(),
      children: z.array(DomNodeSchema),
    }),
    z.strictObject({
      nodeType: z.literal('text'),
      nodeId: NodeIdSchema,
      value: z.string(),
    }),
  ]),
);

/** Exactly what was done to the live DOM to produce this tree. */
export const DomNormalizationSchema = z.strictObject({
  /** Runs of whitespace collapsed to one space; empty text nodes dropped. */
  whitespace: z.literal('collapsed'),
  commentsRemoved: z.literal(true),
  /** `<script>` and `<style>` bodies are omitted; the elements remain. */
  inlineCodeOmitted: z.literal(true),
  /** §11: shadow roots pierced and flattened, marked with SHADOW_MARKER_ATTRIBUTE. */
  shadowDomFlattened: z.boolean(),
  /** Same-origin iframes recursed into nested routes (§11). */
  iframesRecursed: z.boolean(),
});

export const DomDocumentSchema = z.strictObject({
  ...artifactEnvelope('dom-document'),
  routeId: RouteIdSchema,
  /** The document URL after any redirects. */
  documentUrl: AbsoluteUrlSchema,
  doctype: z.string().nullable(),
  lang: z.string().nullable(),
  normalization: DomNormalizationSchema,
  /** The `<html>` element. */
  root: DomNodeSchema,
  nodeCount: z.int().positive(),
  /**
   * Structural hash of the whole tree. This is the `preHash` / `postHash` that
   * §6's behavior probing compares, and what §9's behavioral gate replays against.
   */
  domHash: ShortHashSchema,
});

export type DomNormalization = z.infer<typeof DomNormalizationSchema>;
export type DomDocument = z.infer<typeof DomDocumentSchema>;
