/**
 * Fixture DOM builder.
 *
 * Turns a small declarative tree into the artifacts a real capture writes:
 * a normalized DOM document, a deduplicated style table, and an a11y tree —
 * with node ids, structural paths, and hashes derived exactly the way §5
 * describes, so the fixtures exercise the schema's referential rules rather
 * than merely satisfying its field types.
 */
import { createHash } from 'node:crypto';
// Identifier derivation is part of the contract, not this script — see
// src/identity.ts. Importing it is what keeps the fixtures describing the same
// ids the crawler will produce.
import {
  deriveA11yRef,
  deriveContentFingerprint,
  deriveNodeId,
  deriveStyleId,
  shortHash,
} from '../dist/index.js';

export const SHADOW = 'data-siteforge-shadow';

const sha = (s) => createHash('sha256').update(s).digest('hex');
export const sha256 = sha;
export const short16 = shortHash;
export const short12 = (s) => sha(s).slice(0, 12);

/** Element node in the input DSL. */
export function el(tag, opts = {}, children = []) {
  return { kind: 'el', tag, opts, children };
}
/** Text node in the input DSL. */
export function txt(value) {
  return { kind: 'txt', value };
}

/**
 * Walk the DSL tree and emit { root, nodeCount, domHash, table, assignments, a11yRoot, a11yHash }.
 */
export function materialize(tree, { routeId, pageTitle }) {
  /** styleId -> { declarations, refCount } */
  const styles = new Map();
  /** nodeId -> styleId */
  const assignments = {};
  let nodeCount = 0;

  const styleIdFor = (decls) => {
    const id = deriveStyleId(decls);
    const existing = styles.get(id);
    if (existing) existing.refCount += 1;
    else styles.set(id, { declarations: decls, refCount: 1 });
    return id;
  };

  // a11y nodes are collected during the walk and re-parented to the nearest
  // ancestor that also carries a role, which is what the platform tree does.
  const a11yChildrenOf = new Map();
  const a11yNodes = new Map();

  function walk(node, parentPath, siblingCounts, shadowHostId, a11yParentRef) {
    nodeCount += 1;

    if (node.kind === 'txt') {
      const path = `${parentPath}/#text[${(siblingCounts.get('#text') ?? 0) + 1}]`;
      siblingCounts.set('#text', (siblingCounts.get('#text') ?? 0) + 1);
      const nodeId = deriveNodeId(path, shortHash(node.value));
      return { nodeType: 'text', nodeId, value: node.value };
    }

    const { tag, opts, children } = node;
    const n = (siblingCounts.get(tag) ?? 0) + 1;
    siblingCounts.set(tag, n);
    const path = parentPath === '' ? tag : `${parentPath}/${tag}[${n}]`;

    const attrs = { ...(opts.attrs ?? {}) };
    if (shadowHostId) attrs[SHADOW] = opts.shadowPart ?? 'content';

    const ownText = children
      .filter((c) => c.kind === 'txt')
      .map((c) => c.value)
      .join(' ');
    const contentFingerprint = deriveContentFingerprint({ tag, attributes: attrs, text: ownText });
    const nodeId = deriveNodeId(path, contentFingerprint);

    const styleId = styleIdFor(opts.style ?? {});
    assignments[nodeId] = styleId;

    let a11y;
    let myRef = a11yParentRef;
    if (opts.role) {
      const ref = deriveA11yRef(routeId, nodeId);
      a11y = { ref, role: opts.role, name: opts.name ?? '' };
      const record = {
        ref,
        role: opts.role,
        name: opts.name ?? '',
        nodeId,
        children: [],
        ...(opts.level !== undefined ? { level: opts.level } : {}),
        ...(opts.expanded !== undefined ? { expanded: opts.expanded } : {}),
        ...(opts.disabled !== undefined ? { disabled: opts.disabled } : {}),
        ...(opts.focused !== undefined ? { focused: opts.focused } : {}),
        ...(opts.a11yValue !== undefined ? { value: opts.a11yValue } : {}),
      };
      a11yNodes.set(ref, record);
      const bucket = a11yChildrenOf.get(a11yParentRef) ?? [];
      bucket.push(ref);
      a11yChildrenOf.set(a11yParentRef, bucket);
      myRef = ref;
    }

    const nextShadowHost = opts.shadowHost ? nodeId : shadowHostId;
    const childCounts = new Map();
    const kids = children.map((c) => walk(c, path, childCounts, nextShadowHost, myRef));

    return {
      nodeType: 'element',
      nodeId,
      identity: { structuralPath: path, contentFingerprint },
      tag,
      attributes: attrs,
      styleId,
      ...(a11y ? { a11y } : {}),
      ...(opts.box ? { boundingBox: opts.box } : {}),
      ...(opts.interaction ? { interaction: opts.interaction } : {}),
      ...(opts.shadowHost ? { shadowHost: opts.shadowHost } : {}),
      ...(shadowHostId ? { withinShadowRootOf: shadowHostId } : {}),
      ...(opts.iframe ? { iframe: opts.iframe } : {}),
      children: kids,
    };
  }

  const root = walk(tree, '', new Map(), undefined, 'ROOT');

  const assemble = (ref) => {
    const rec = a11yNodes.get(ref);
    return { ...rec, children: (a11yChildrenOf.get(ref) ?? []).map(assemble) };
  };
  const a11yRoot = {
    ref: deriveA11yRef(routeId, deriveNodeId('#document', shortHash(routeId))),
    role: 'RootWebArea',
    name: pageTitle,
    children: (a11yChildrenOf.get('ROOT') ?? []).map(assemble),
  };

  const serializeDom = (n) =>
    n.nodeType === 'text'
      ? `#${n.value}`
      : `<${n.tag} ${JSON.stringify(n.attributes)} ${n.styleId}>${n.children.map(serializeDom).join('')}</${n.tag}>`;
  const serializeA11y = (n) =>
    `(${n.role}:${n.name}${n.children.map(serializeA11y).join('')})`;

  const table = [...styles.entries()].map(([styleId, v]) => ({
    styleId,
    declarations: v.declarations,
    refCount: v.refCount,
  }));

  return {
    root,
    nodeCount,
    domHash: shortHash(serializeDom(root)),
    a11yRoot,
    a11yHash: shortHash(serializeA11y(a11yRoot)),
    table,
    assignments,
    styledNodeCount: Object.keys(assignments).length,
  };
}
