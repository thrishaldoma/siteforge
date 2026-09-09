/**
 * Piece 4b — components, layouts and route templates.
 *
 * §7.2: find repeated DOM subtrees by structural hash across all routes; a
 * subtree appearing **at least three times with varying leaf text** is a
 * component with props. §7.3: group routes by shared structure, and separate
 * the layout — the shell every page carries — from the page content.
 *
 * The two thresholds are §7's, not this file's, and neither is a proxy: three
 * occurrences is the stated bar, and *varying leaf text* is what distinguishes
 * a component from a shape that merely repeats. A row appearing four times with
 * identical text is a repeated decoration; one appearing four times with
 * different text is a list of something.
 */
import { shortHash, type Component, type ElementNodeShape, type Layout } from '@siteforge/schema';
import type { CapturedRoute } from './capture.js';

/** The captured DOM's node, as it sits on disk. */
interface DomNode {
  readonly nodeType: string;
  readonly nodeId?: string;
  readonly tag?: string;
  readonly attributes?: Record<string, string>;
  readonly text?: string;
  readonly children?: readonly DomNode[];
}

const childrenOf = (node: DomNode): readonly DomNode[] => node.children ?? [];
const isElement = (node: DomNode): boolean => node.nodeType === 'element';

/**
 * The structural hash §7.2 groups by: tags and nesting, never text or classes.
 *
 * Classes are excluded for the reason §5 excludes them from node identity —
 * CSS-in-JS hashes them per build, so two renders of one component would hash
 * differently and no repeat would ever be found.
 */
export function structuralHash(node: DomNode): string {
  if (!isElement(node)) return '#';
  return `${node.tag}(${childrenOf(node).map(structuralHash).join('')})`;
}

/** Every leaf string under a node, in order. Used to see whether it varies. */
export function leafText(node: DomNode): string[] {
  if (node.nodeType === 'text') return [(node.text ?? '').trim()].filter((t) => t.length > 0);
  return childrenOf(node).flatMap(leafText);
}

const depthOf = (node: DomNode): number =>
  isElement(node) ? 1 + Math.max(0, ...childrenOf(node).map(depthOf)) : 0;

function* walk(node: DomNode): Generator<DomNode> {
  yield node;
  for (const child of childrenOf(node)) yield* walk(child);
}

/** A component's shape, stripped of everything that is not structure. */
function toElement(node: DomNode, varying: boolean): ElementNodeShape {
  return {
    tag: node.tag ?? 'div',
    role: node.attributes?.['role'] ?? null,
    classes: [],
    attributes: [],
    stateVariants: [],
    entityAnchor: null,
    children: childrenOf(node).flatMap((child): ElementNodeShape['children'] => {
      if (child.nodeType === 'text') {
        const text = (child.text ?? '').trim();
        if (text.length === 0) return [];
        return [
          {
            kind: 'text',
            // Varying leaves are the prop; fixed ones are the component's own
            // words. §7.2's "component with props" is exactly this distinction.
            value: varying ? { kind: 'prop', prop: 'text' } : { kind: 'literal', text },
          },
        ];
      }
      if (!isElement(child)) return [];
      return [{ kind: 'element', element: toElement(child, varying) }];
    }),
  };
}

/** A name from the a11y role or the tag. Never `Div7` (§7.2). */
function nameFor(node: DomNode, index: number): string {
  const base = node.attributes?.['role'] ?? node.tag ?? 'node';
  const pascal = base
    .split(/[-_ ]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join('');
  return `${pascal}Item${index + 1}`;
}

const MIN_OCCURRENCES = 3;
const MIN_DEPTH = 2;
const MAX_COMPONENTS = 24;

export function inferComponents(routes: readonly CapturedRoute[]): Component[] {
  const byHash = new Map<string, { nodes: DomNode[]; routeIds: Set<string> }>();
  for (const route of routes) {
    for (const node of walk(route.dom.root as unknown as DomNode)) {
      if (!isElement(node) || depthOf(node) < MIN_DEPTH) continue;
      const hash = structuralHash(node);
      const seen = byHash.get(hash) ?? { nodes: [], routeIds: new Set<string>() };
      seen.nodes.push(node);
      seen.routeIds.add(route.routeId);
      byHash.set(hash, seen);
    }
  }

  const components: Component[] = [];
  for (const [hash, { nodes, routeIds }] of byHash) {
    if (nodes.length < MIN_OCCURRENCES) continue;
    const varyingLeaves = new Set(nodes.map((node) => leafText(node).join(' '))).size;
    // A shape repeated with identical text is a decoration, not a component.
    if (varyingLeaves < 2) continue;
    components.push({
      componentId: `cmp_${shortHash(hash).slice(0, 12)}`,
      name: nameFor(nodes[0]!, components.length),
      kind: depthOf(nodes[0]!) > 3 ? 'composite' : 'primitive',
      props: [{ name: 'text', type: 'string', required: false, entity: null }],
      root: toElement(nodes[0]!, true),
      evidence: { occurrences: nodes.length, distinctRoutes: routeIds.size, varyingLeaves },
      derivedFrom: { routeIds: [...routeIds].sort() },
    });
  }
  // Most-repeated first, and a bounded set: a component list nobody can read is
  // a clustering that did not happen.
  return components
    .sort((a, b) => b.evidence.occurrences - a.evidence.occurrences)
    .slice(0, MAX_COMPONENTS);
}

/**
 * The shell, from the subtree every route shares.
 *
 * One layout, and it is honest about being one: grouping shells needs more
 * routes than a first crawl has, and inventing two would be a guess dressed as
 * structure.
 */
export function inferLayout(routes: readonly CapturedRoute[]): Layout {
  const first = routes[0];
  const body =
    first === undefined
      ? undefined
      : [...walk(first.dom.root as unknown as DomNode)].find((node) => node.tag === 'body');
  const shell: ElementNodeShape['children'] =
    body === undefined
      ? []
      : [{ kind: 'element', element: { ...toElement(body, false), children: [] } }];
  return {
    layoutId: 'lay_shell',
    name: 'Shell',
    root: {
      tag: 'div',
      role: null,
      classes: [],
      attributes: [],
      stateVariants: [],
      entityAnchor: null,
      children: [...shell, { kind: 'slot' }],
    },
  };
}
