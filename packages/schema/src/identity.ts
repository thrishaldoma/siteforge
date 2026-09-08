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
import type { A11yRef, ContextId, NodeId, RouteId, ShortHash, StyleId } from './primitives.js';
import type { StyleDeclaration } from './styles.js';

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/** Truncation used for every short fingerprint in the model. */
export const SHORT_HASH_LENGTH = 16;
/** Truncation used for a11y refs, which appear in far greater numbers. */
export const A11Y_REF_LENGTH = 12;

export const shortHash = (input: string): ShortHash => sha256Hex(input).slice(0, SHORT_HASH_LENGTH);

/**
 * Attributes that contribute to a node's **semantic key** — the authored,
 * data-independent half of its identity.
 *
 * The membership rule: an attribute belongs here only if a developer typed it and
 * it does not change when the site's *data* changes. Everything else is content.
 *
 * Excluded, and why:
 *   - `class`   §11: CSS-in-JS classnames are hashed and change every rebuild.
 *   - `style`   computed style is addressed by `styleId`.
 *   - `href` / `src` / `alt` / `title` / `value` / `placeholder` / `aria-label`
 *              all carry data on a live site. A product link's href holds a slug;
 *              an aria-label holds the product name. Folding them in means every
 *              nodeId moves when the catalogue does.
 *
 * A framework-generated `id` is dropped even though it appears here — see
 * `isFrameworkGeneratedId`.
 */
export const SEMANTIC_ATTRIBUTES = [
  'id',
  'name',
  'type',
  'role',
  'data-testid',
  'data-test',
  'data-cy',
] as const;

/**
 * Attributes that carry content, and so contribute to the content fingerprint
 * rather than to the node's identity.
 */
export const CONTENT_ATTRIBUTES = [
  'href',
  'src',
  'srcset',
  'alt',
  'title',
  'value',
  'placeholder',
  'aria-label',
] as const;

/**
 * Ids a framework minted at render time. They look stable and are not: React's
 * `useId` counts up per render tree, Angular's `ng-*` counts up per component
 * instance, and both shift when anything above them changes.
 *
 * Treating one as authored identity is worse than having no id at all, because it
 * silently reintroduces exactly the instability the semantic key exists to avoid.
 */
export function isFrameworkGeneratedId(value: string): boolean {
  return (
    /^:[A-Za-z0-9]*:$/.test(value) ||                              // React useId: :r0:, :R1abc:
    /(?:^|[-_]):[A-Za-z0-9]+:(?:[-_]|$)/.test(value) ||            // radix-:r1:, headlessui-...-:r2:
    /^_?ng(?:[-_]|content|reflect|version|star)/.test(value) ||     // Angular ng-*, _ngcontent-*, ng-star-*
    /^mui-\d+$/.test(value) ||                                     // Material UI
    /^rc[-_][A-Za-z0-9]{4,}$/.test(value) ||                       // Ant Design rc-*
    /^v-[0-9a-f]{6,}$/.test(value) ||                              // Vue scope ids
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || // uuid
    /^[a-z]?[0-9a-f]{8,}$/i.test(value) ||                         // bare hash blob
    /^(?:uid|uuid|el|node|item|component|input|field)[-_]?\d{3,}$/i.test(value)
  );
}

/**
 * The authored, data-independent identity of a node.
 *
 * Combined with the structural path to form the nodeId, so an id is stable under
 * restyling *and* under content change, and moves only when the page's structure
 * moves. That is a deliberate departure from §5's literal wording ("a structural
 * path hash plus a content fingerprint") — see docs/decisions/0005: folding
 * content into the id makes every price, timestamp, and count on a live site
 * relocate every node beneath it, which destroys the diffs the id exists to serve.
 */
export function deriveSemanticKey(node: {
  tag: string;
  attributes: Readonly<Record<string, string>>;
}): ShortHash {
  const parts = [node.tag.toLowerCase()];
  for (const attr of SEMANTIC_ATTRIBUTES) {
    const value = node.attributes[attr] ?? '';
    const usable = attr === 'id' && isFrameworkGeneratedId(value) ? '' : value;
    parts.push(`${attr}=${usable}`);
  }
  return shortHash(parts.join('|'));
}

/**
 * Fingerprint of what a node currently *says*.
 *
 * Recorded on every node but deliberately **not** part of the nodeId. It is the
 * diff-attribution half: when two crawls agree on a nodeId and disagree here, the
 * node is the same and its content changed — which is precisely the distinction
 * §5 wants diffs to be able to make.
 *
 * `text` is the node's own direct text, whitespace-collapsed — not its subtree's,
 * or every ancestor would change whenever any descendant did.
 */
export function deriveContentFingerprint(node: {
  tag: string;
  attributes: Readonly<Record<string, string>>;
  text: string;
}): ShortHash {
  const parts: string[] = [];
  for (const attr of CONTENT_ATTRIBUTES) parts.push(`${attr}=${node.attributes[attr] ?? ''}`);
  parts.push(`#${node.text.replace(/\s+/g, ' ').trim()}`);
  return shortHash(parts.join('|'));
}

/**
 * §5: "Derive from a structural path hash (`tag[nth-of-type]/...`) ... not from
 * DOM order alone." The second input is the semantic key, not the content
 * fingerprint — see `deriveSemanticKey` and docs/decisions/0005.
 */
export function deriveNodeId(structuralPath: string, semanticKey: ShortHash): NodeId {
  return `n_${shortHash(`${structuralPath}|${semanticKey}`)}`;
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

/**
 * Derived from the node alone, deliberately **not** from the route.
 *
 * Scoping refs to a route would mean two byte-identical captures of one URL under
 * different contexts produced different refs, so their artifacts could never hash
 * equal and `RouteMeta.content`'s shared-content pointer would never fire. Refs
 * only need to be unique within one observation, and nodeIds already are.
 */
export function deriveA11yRef(nodeId: NodeId): A11yRef {
  return `a11y_${sha256Hex(`a11y|${nodeId}`).slice(0, A11Y_REF_LENGTH)}`;
}

/**
 * The a11y tree's synthetic root, which corresponds to the document rather than
 * to any element. Derived from the document URL so it is route-independent for
 * the same reason refs are.
 */
export function deriveDocumentA11yRef(documentUrl: string): A11yRef {
  return deriveA11yRef(deriveNodeId('#document', shortHash(documentUrl)));
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
 * The composite capture key: `<pattern-slug>--<context-id>--i<instance>`
 * (docs/decisions/0002, revised by 0004).
 *
 * A route captured inside a same-origin iframe inherits its parent's context and
 * records the frame's content box as `renderedSize` — the frame box is a property
 * of the embed, not a capture condition, so it does not belong in the id.
 */
export function deriveRouteId(
  urlPattern: string,
  contextId: ContextId,
  instanceIndex: number,
): RouteId {
  return `${slugifyUrlPattern(urlPattern)}--${contextId}--i${instanceIndex}`;
}

/**
 * `endpointId` from the method and the normalized path pattern.
 *
 * Derivation is contract, not convenience (decision 0011): the id is a *derived*
 * field, so the schema recomputes it rather than trusting what a producer wrote.
 * The fixture claimed `get-api-products-id` for `/api/products/:slug` — an id
 * that had drifted from its own pattern and would have had infer and codegen
 * disagreeing about which endpoint they were discussing.
 */
export function deriveEndpointId(method: string, pathPattern: string): string {
  return `${method.toLowerCase()}${pathPattern.replace(/[/:]+/g, '-').replace(/-+$/, '').toLowerCase()}`
    .replace(/-{2,}/g, '-');
}

/** Methods that cannot mutate. §8: "Mutations actually mutate the store." */
export const SAFE_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/** The `:param` names a pattern declares, in order. */
export function patternParams(pattern: string): string[] {
  return [...pattern.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]!);
}
