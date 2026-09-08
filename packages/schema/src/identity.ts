/**
 * Identifier derivation.
 *
 * These functions are part of the contract, not a helper library. §5 constrains
 * the *format* of a nodeId; this file fixes how one is *computed*. If capture
 * derived ids one way and the fixtures another, both would satisfy
 * `NodeIdSchema` while describing different worlds, and §5's "they must survive
 * re-crawls so diffs are meaningful" would be quietly false.
 *
 * Every producer of an id — the crawler, the fixture builder, the runtime action
 * space — must call these rather than reimplement them.
 */
import { createHash } from 'node:crypto';
import type { A11yRef, NodeId, RouteId, ShortHash, StyleId, Viewport } from './primitives.js';
import type { StyleDeclaration } from './styles.js';

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/** Truncation used for every short fingerprint in the model. */
export const SHORT_HASH_LENGTH = 16;
/** Truncation used for a11y refs, which appear in far greater numbers. */
export const A11Y_REF_LENGTH = 12;

export const shortHash = (input: string): ShortHash => sha256Hex(input).slice(0, SHORT_HASH_LENGTH);

/**
 * Attributes that contribute to a node's content fingerprint.
 *
 * `class` is deliberately absent. §11: "CSS-in-JS hashed classnames — normalize
 * by computed style value, never by class name." Folding an unstable classname
 * into the fingerprint would change every nodeId on the page whenever the site
 * rebuilds, which defeats the entire purpose of a stable id.
 *
 * `style` is absent for the same reason: the computed style lives in the style
 * table, addressed by `styleId`.
 */
export const IDENTIFYING_ATTRIBUTES = [
  'id',
  'name',
  'type',
  'href',
  'src',
  'alt',
  'title',
  'value',
  'placeholder',
  'role',
  'aria-label',
] as const;

/**
 * Fingerprint of what a node *is*, independent of where it sits.
 *
 * `text` is the node's own direct text content, whitespace-collapsed — not its
 * subtree's, or every ancestor would change whenever any descendant did.
 */
export function deriveContentFingerprint(node: {
  tag: string;
  attributes: Readonly<Record<string, string>>;
  text: string;
}): ShortHash {
  const parts = [node.tag.toLowerCase()];
  for (const attr of IDENTIFYING_ATTRIBUTES) parts.push(`${attr}=${node.attributes[attr] ?? ''}`);
  parts.push(`#${node.text.replace(/\s+/g, ' ').trim()}`);
  return shortHash(parts.join('|'));
}

/**
 * §5: "Derive from a structural path hash (`tag[nth-of-type]/...`) plus a content
 * fingerprint, not from DOM order alone."
 *
 * Both halves are retained on the node as `NodeIdentity`, so a changed id can be
 * attributed to structure or to content.
 */
export function deriveNodeId(structuralPath: string, contentFingerprint: ShortHash): NodeId {
  return `n_${shortHash(`${structuralPath}|${contentFingerprint}`)}`;
}

/**
 * Canonical serialization of a computed style object: keys sorted, so two nodes
 * whose styles differ only in property order collapse to one table entry.
 * This *is* the deduplication rule §5 hangs its size argument on.
 */
export function canonicalizeStyleDeclarations(declarations: StyleDeclaration): string {
  const entries = Object.entries(declarations).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

export function deriveStyleId(declarations: StyleDeclaration): StyleId {
  return `s_${shortHash(canonicalizeStyleDeclarations(declarations))}`;
}

/** Refs are scoped to a route: the same element in two captures is two refs. */
export function deriveA11yRef(routeId: RouteId, nodeId: NodeId): A11yRef {
  return `a11y_${sha256Hex(`${routeId}|${nodeId}`).slice(0, A11Y_REF_LENGTH)}`;
}

/**
 * `/product/:id` → `product-id`, `/` → `root`.
 *
 * Parameter markers lose their colon, so `/product/:id` and `/product/:slug`
 * produce different slugs — the pattern is the route's identity (§5) and two
 * differently-named parameters are two different patterns.
 */
export function slugifyUrlPattern(urlPattern: string): string {
  const slug = urlPattern
    .replace(/^\/+|\/+$/g, '')
    .replace(/:/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'root' : slug;
}

/**
 * The composite capture key settled in docs/decisions/0002:
 * `<pattern-slug>--i<instance>--<width>x<height>`.
 *
 * For a route captured inside a same-origin iframe the viewport is the frame's
 * content box, not a browser viewport — see `RouteMeta.embeddedIn`.
 */
export function deriveRouteId(
  urlPattern: string,
  instanceIndex: number,
  viewport: Pick<Viewport, 'width' | 'height'>,
): RouteId {
  return `${slugifyUrlPattern(urlPattern)}--i${instanceIndex}--${viewport.width}x${viewport.height}`;
}
