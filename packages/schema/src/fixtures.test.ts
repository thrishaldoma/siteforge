/**
 * Fixture suite.
 *
 * Two jobs, and the second is the important one:
 *
 *  1. Every artifact in `fixtures/capture/northwind-supply/` parses against its
 *     schema.
 *  2. The artifacts are *referentially* consistent with each other.
 *
 * (1) alone proves almost nothing. This schema's risk is not "is `title` a
 * string" — it is whether a nodeId written by one file resolves in another, and
 * whether the deduplication §5 hangs the whole size argument on actually holds.
 * Those are the assertions below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  AssetIndexSchema,
  CAPTURE_MODEL_VERSION,
  CaptureManifestSchema,
  CaptureModelSchema,
  DomDocumentSchema,
  EndpointIndexSchema,
  FlowTraceSchema,
  RouteMetaSchema,
  StageReportSchema,
  StateDeltasDocumentSchema,
  StyleSheetDocumentSchema,
  VOLATILE_ARTIFACT_KEYS,
  canonicalizeStyleDeclarations,
  deriveA11yRef,
  deriveContentFingerprint,
  deriveNodeId,
  deriveRouteId,
  deriveStyleId,
  type DomDocument,
  type DomNode,
  type A11yNode,
} from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'capture', 'northwind-supply');
const read = (rel: string): unknown => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const routeIds = readdirSync(join(ROOT, 'routes')).sort();
const flowFiles = readdirSync(join(ROOT, 'flows')).sort();

const manifest = CaptureManifestSchema.parse(read('manifest.json'));
const assets = AssetIndexSchema.parse(read('assets/index.json'));
const endpoints = EndpointIndexSchema.parse(read('network/endpoints.json'));
const report = StageReportSchema.parse(read('stage-report.json'));
const routes = new Map(
  routeIds.map((id) => [
    id,
    {
      meta: RouteMetaSchema.parse(read(`routes/${id}/meta.json`)),
      dom: DomDocumentSchema.parse(read(`routes/${id}/dom.json`)),
      styles: StyleSheetDocumentSchema.parse(read(`routes/${id}/styles.json`)),
      states: StateDeltasDocumentSchema.parse(read(`routes/${id}/states.json`)),
    },
  ]),
);
const flows = new Map(
  flowFiles.map((f) => {
    const flow = FlowTraceSchema.parse(read(`flows/${f}`));
    return [flow.flowId, flow];
  }),
);

/* --------------------------------------------------------------- utilities */

function elements(doc: DomDocument): Map<string, Extract<DomNode, { nodeType: 'element' }>> {
  const out = new Map<string, Extract<DomNode, { nodeType: 'element' }>>();
  const walk = (n: DomNode): void => {
    if (n.nodeType !== 'element') return;
    out.set(n.nodeId, n);
    n.children.forEach(walk);
  };
  walk(doc.root);
  return out;
}
function allNodeIds(doc: DomDocument): Set<string> {
  const out = new Set<string>();
  const walk = (n: DomNode): void => {
    out.add(n.nodeId);
    if (n.nodeType === 'element') n.children.forEach(walk);
  };
  walk(doc.root);
  return out;
}
function a11yRefs(node: A11yNode): Set<string> {
  const out = new Set<string>([node.ref]);
  for (const child of node.children) for (const r of a11yRefs(child)) out.add(r);
  return out;
}

/* ------------------------------------------------------------------- parsing */

describe('every fixture artifact parses', () => {
  it('has the expected shape on disk', () => {
    expect(routeIds).toEqual([
      'account-orders--i0--1280x800',
      'embeds-size-guide--i0--640x420',
      'product-id--i0--1280x800',
      'product-id--i0--390x844',
      'product-id--i1--1280x800',
      'root--i0--1280x800',
    ]);
    expect(flowFiles).toHaveLength(3);
  });

  it.each([...routes.keys()])('route %s parses all four artifacts', (id) => {
    const r = routes.get(id)!;
    expect(r.meta.routeId).toBe(id);
    expect(r.dom.routeId).toBe(id);
    expect(r.styles.routeId).toBe(id);
    expect(r.states.routeId).toBe(id);
  });

  it('stamps one model version everywhere', () => {
    const artifacts = [
      manifest, assets, endpoints, report,
      ...[...routes.values()].flatMap((r) => [r.meta, r.dom, r.styles, r.states]),
      ...flows.values(),
    ];
    for (const a of artifacts) {
      expect(a.modelVersion).toBe(CAPTURE_MODEL_VERSION);
      // §3.4: the scrub assertion is unrepresentable-if-false, but check it lands.
      expect(a.scrubbed).toBe(true);
    }
  });

  it('assembles into a CaptureModel', () => {
    const model = CaptureModelSchema.parse({
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest,
      routes: Object.fromEntries(routes),
      assets,
      endpoints,
      flows: Object.fromEntries(flows),
      stageReport: report,
    });
    expect(Object.keys(model.routes)).toHaveLength(routes.size);
  });
});

/* ------------------------------------------------------- referential integrity */

describe('referential integrity across files', () => {
  it.each([...routes.keys()])('%s: every styled nodeId exists in dom.json', (id) => {
    const { dom, styles } = routes.get(id)!;
    const ids = allNodeIds(dom);
    for (const nodeId of Object.keys(styles.assignments)) {
      expect(ids.has(nodeId), `${nodeId} assigned a style but absent from dom.json`).toBe(true);
    }
  });

  it.each([...routes.keys()])('%s: every element has exactly one style assignment', (id) => {
    const { dom, styles } = routes.get(id)!;
    const els = elements(dom);
    for (const nodeId of els.keys()) {
      expect(styles.assignments[nodeId], `element ${nodeId} has no style assignment`).toBeDefined();
    }
    expect(Object.keys(styles.assignments)).toHaveLength(els.size);
    expect(styles.stats.styledNodeCount).toBe(els.size);
  });

  it.each([...routes.keys()])('%s: styleIds resolve, the table has no orphans, refCounts agree', (id) => {
    const { dom, styles } = routes.get(id)!;
    const table = new Map(styles.table.map((e) => [e.styleId, e]));
    expect(table.size).toBe(styles.table.length);
    expect(styles.stats.distinctStyles).toBe(table.size);

    const used = new Map<string, number>();
    for (const el of elements(dom).values()) {
      expect(table.has(el.styleId), `${el.styleId} referenced by ${el.nodeId} is not in the table`).toBe(true);
      expect(styles.assignments[el.nodeId]).toBe(el.styleId);
      used.set(el.styleId, (used.get(el.styleId) ?? 0) + 1);
    }
    // An entry nothing points at is dead weight in the artifact §5 is trying to shrink.
    for (const styleId of table.keys()) {
      expect(used.get(styleId), `style ${styleId} is an orphan`).toBeGreaterThan(0);
      expect(table.get(styleId)!.refCount).toBe(used.get(styleId));
    }
  });

  it.each([...routes.keys()])('%s: deduplication actually happens (the §5 size claim)', (id) => {
    const { styles } = routes.get(id)!;
    expect(styles.stats.distinctStyles).toBeLessThan(styles.stats.styledNodeCount);
    expect(styles.stats.dedupeRatio).toBeCloseTo(styles.stats.distinctStyles / styles.stats.styledNodeCount, 4);
  });

  it.each([...routes.keys()])('%s: every nodeId in states.json exists in dom.json', (id) => {
    const { dom, states } = routes.get(id)!;
    const ids = allNodeIds(dom);
    for (const entry of states.entries) {
      const referenced =
        entry.source === 'cssom' ? entry.matchedNodeIds
        : entry.source === 'probed' ? [entry.nodeId]
        : [...entry.addedNodeIds, ...entry.changedNodeIds, ...entry.styleChanges.map((c) => c.nodeId)];
      for (const nodeId of referenced) {
        expect(ids.has(nodeId), `states.json references unknown node ${nodeId}`).toBe(true);
      }
    }
  });

  it.each([...routes.keys()])('%s: scroll state steps index a real screenshot', (id) => {
    const { meta, states } = routes.get(id)!;
    const steps = new Set(meta.screenshots.scroll.map((s) => s.index));
    for (const entry of states.entries) {
      if (entry.source === 'scroll') {
        expect(steps.has(entry.scrollStep), `scroll step ${entry.scrollStep} has no screenshot`).toBe(true);
      }
    }
    expect(meta.screenshots.scroll).toHaveLength(meta.pageMetrics.scrollSteps);
  });

  it('every asset reference points at something real', () => {
    const styleIdsByRoute = new Map(
      [...routes.entries()].map(([id, r]) => [id, new Set(r.styles.table.map((e) => e.styleId))]),
    );
    const nodeIdsByRoute = new Map([...routes.entries()].map(([id, r]) => [id, allNodeIds(r.dom)]));
    const endpointIds = new Set(endpoints.endpoints.map((e) => e.endpointId));
    const assetIds = new Set(Object.values(assets.byUrl).map((a) => a.assetId));

    let refCount = 0;
    for (const [url, asset] of Object.entries(assets.byUrl)) {
      expect(asset.originalUrl).toBe(url);
      expect(asset.localPath).toBe(`assets/files/${asset.sha256}.${asset.localPath.split('.').pop()}`);
      for (const ref of asset.referencedBy) {
        refCount += 1;
        switch (ref.kind) {
          case 'dom-attribute':
            expect(nodeIdsByRoute.get(ref.routeId)?.has(ref.nodeId), `${url} claims node ${ref.nodeId}`).toBe(true);
            break;
          case 'css-url':
            if (ref.styleId) {
              expect(styleIdsByRoute.get(ref.routeId)?.has(ref.styleId), `${url} claims style ${ref.styleId}`).toBe(true);
            }
            break;
          case 'font-face':
            expect(routes.has(ref.routeId)).toBe(true);
            expect(routes.get(ref.routeId)!.styles.fonts.map((f) => f.family)).toContain(ref.family);
            break;
          case 'network':
            expect(endpointIds.has(ref.endpointId)).toBe(true);
            break;
          case 'asset-import':
            expect(assetIds.has(ref.fromAssetId)).toBe(true);
            break;
        }
      }
    }
    expect(refCount).toBeGreaterThan(20);
    expect(assets.stats.assetCount).toBe(Object.keys(assets.byUrl).length);
  });

  it('every font declared in styles.json resolves to a captured asset', () => {
    const assetIds = new Set(Object.values(assets.byUrl).map((a) => a.assetId));
    for (const r of routes.values()) {
      for (const font of r.styles.fonts) {
        for (const src of font.sources) {
          if (src.assetId) expect(assetIds.has(src.assetId), `font ${font.family} names an unknown asset`).toBe(true);
        }
      }
    }
  });

  it('iframe placeholders name a captured asset and a real gap', () => {
    const assetIds = new Set(Object.values(assets.byUrl).map((a) => a.assetId));
    const gapIds = new Set(report.gaps.map((g) => g.gapId));
    let seen = 0;
    for (const r of routes.values()) {
      for (const el of elements(r.dom).values()) {
        if (el.iframe && !el.iframe.sameOrigin) {
          seen += 1;
          expect(assetIds.has(el.iframe.placeholderAssetId)).toBe(true);
          expect(gapIds.has(el.iframe.gapId)).toBe(true);
        }
      }
    }
    // Every route that renders the site shell carries the third-party footer frame;
    // the nested embed is a standalone document and has no shell.
    expect(seen).toBe(routes.size - 1);
  });

  it('same-origin iframes resolve to a nested route that points back (§11)', () => {
    let recursed = 0;
    for (const [parentId, r] of routes) {
      for (const el of elements(r.dom).values()) {
        if (!el.iframe?.sameOrigin) continue;
        recursed += 1;
        const nested = routes.get(el.iframe.routeId);
        expect(nested, `iframe names unknown route ${el.iframe.routeId}`).toBeDefined();
        // The nested route must know which frames embedded it, or codegen cannot
        // place it back where it came from.
        const back = nested!.meta.embeddedIn.find((e) => e.routeId === parentId && e.nodeId === el.nodeId);
        expect(back, `${el.iframe.routeId} does not list ${parentId} in embeddedIn`).toBeDefined();
      }
      expect(r.dom.normalization.iframesRecursed).toBe(
        [...elements(r.dom).values()].some((e) => e.iframe?.sameOrigin === true),
      );
    }
    expect(recursed).toBeGreaterThan(0);
  });

  it('an embedded route is discovered through the frame that hosts it', () => {
    for (const r of routes.values()) {
      if (r.meta.embeddedIn.length === 0) continue;
      expect(r.meta.discoveredFrom.kind).toBe('iframe');
      if (r.meta.discoveredFrom.kind === 'iframe') {
        const hosts = r.meta.embeddedIn.map((e) => `${e.routeId}/${e.nodeId}`);
        expect(hosts).toContain(`${r.meta.discoveredFrom.routeId}/${r.meta.discoveredFrom.nodeId}`);
      }
    }
  });

  it('redirect chains terminate at the recorded URL', () => {
    let withRedirects = 0;
    for (const r of routes.values()) {
      expect(r.dom.documentUrl).toBe(r.meta.url);
      if (r.meta.redirectChain.length === 0) continue;
      withRedirects += 1;
      expect(r.meta.redirectChain.at(-1)!.to).toBe(r.meta.url);
      // Each hop must start where the previous one landed.
      r.meta.redirectChain.forEach((hop, i) => {
        const prev = r.meta.redirectChain[i - 1];
        if (prev) expect(hop.from).toBe(prev.to);
      });
    }
    expect(withRedirects, 'no fixture exercises a redirect chain').toBeGreaterThan(0);
  });

  it('every endpoint a flow calls exists in endpoints.json', () => {
    const byId = new Map(endpoints.endpoints.map((e) => [e.endpointId, e]));
    let calls = 0;
    for (const flow of flows.values()) {
      for (const step of flow.steps) {
        for (const call of step.networkCalls) {
          calls += 1;
          if (call.endpointId === null) continue;
          const endpoint = byId.get(call.endpointId);
          expect(endpoint, `flow ${flow.flowId} calls unknown endpoint ${call.endpointId}`).toBeDefined();
          expect(endpoint!.method).toBe(call.method);
          expect(endpoint!.pathPattern).toBe(call.pathPattern);
          expect(endpoint!.isMutation).toBe(call.isMutation);
          expect(endpoint!.responses.map((r) => r.status)).toContain(call.status);
        }
      }
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('every flow target resolves in both the a11y tree and the DOM', () => {
    for (const flow of flows.values()) {
      const refs = a11yRefs(flow.initialA11yTree);
      const nodeIds = allNodeIds(routes.get(flow.startRouteId)!.dom);
      for (const step of flow.steps) {
        if (!step.target) continue;
        expect(refs.has(step.target.ref), `flow ${flow.flowId} targets unknown a11y ref`).toBe(true);
        expect(nodeIds.has(step.target.nodeId), `flow ${flow.flowId} targets unknown node`).toBe(true);
        if ('ref' in step.action) expect(step.action.ref).toBe(step.target.ref);
      }
    }
  });

  it('flow DOM deltas only reference nodes on the start route', () => {
    for (const flow of flows.values()) {
      const nodeIds = allNodeIds(routes.get(flow.startRouteId)!.dom);
      for (const step of flow.steps) {
        const touched = [
          ...step.domDelta.removedNodeIds,
          ...step.domDelta.attributeChanges.map((c) => c.nodeId),
          ...step.domDelta.textChanges.map((c) => c.nodeId),
          ...step.domDelta.styleChanges.map((c) => c.nodeId),
        ];
        for (const nodeId of touched) {
          expect(nodeIds.has(nodeId), `flow ${flow.flowId} step ${step.index} touches unknown node`).toBe(true);
        }
      }
    }
  });

  it('a skipped flow names a gap that exists', () => {
    const gapIds = new Set(report.gaps.map((g) => g.gapId));
    const skipped = [...flows.values()].filter((f) => f.outcome === 'skipped');
    expect(skipped).toHaveLength(1);
    for (const flow of skipped) {
      expect(flow.steps).toHaveLength(0);
      expect(gapIds.has(flow.skipReason!.gapId)).toBe(true);
    }
  });

  it('every gapId referenced anywhere is defined in stage-report.json', () => {
    const defined = new Set(report.gaps.map((g) => g.gapId));
    const referenced = new Set<string>();
    for (const r of routes.values()) r.meta.gapIds.forEach((g) => referenced.add(g));
    for (const f of flows.values()) f.gapIds.forEach((g) => referenced.add(g));
    for (const e of endpoints.endpoints) if (e.stub) referenced.add(e.stub.gapId);
    for (const o of endpoints.thirdPartyOrigins) if (o.gapId) referenced.add(o.gapId);
    for (const gapId of referenced) {
      expect(defined.has(gapId), `${gapId} is referenced but never defined`).toBe(true);
    }
    expect(referenced.size).toBe(defined.size);
  });

  it('every gap that affects behavior names its stub (§1)', () => {
    for (const gap of report.gaps) {
      if (gap.severity !== 'info') {
        expect(gap.stub.kind, `${gap.gapId} is ${gap.severity} but stubs nothing`).not.toBe('none');
      }
    }
  });
});

/* --------------------------------------------------- derivation is the contract */

describe('identifiers are derived the way the contract says (§5)', () => {
  // The point of exporting the derivation from `schema` is that capture, the
  // fixture builder, and the runtime cannot drift. These recompute every id in
  // the fixtures from its stored inputs; if `packages/capture` ever implements
  // its own scheme, this is what catches it.
  it.each([...routes.keys()])('%s: every nodeId recomputes from its stored identity', (id) => {
    const { dom } = routes.get(id)!;
    for (const el of elements(dom).values()) {
      expect(deriveNodeId(el.identity.structuralPath, el.identity.contentFingerprint)).toBe(el.nodeId);
    }
  });

  it.each([...routes.keys()])('%s: every content fingerprint recomputes from tag, attributes, text', (id) => {
    const { dom } = routes.get(id)!;
    for (const el of elements(dom).values()) {
      const text = el.children
        .filter((c): c is Extract<DomNode, { nodeType: 'text' }> => c.nodeType === 'text')
        .map((c) => c.value)
        .join(' ');
      expect(deriveContentFingerprint({ tag: el.tag, attributes: el.attributes, text })).toBe(
        el.identity.contentFingerprint,
      );
    }
  });

  it.each([...routes.keys()])('%s: every styleId is the hash of its own declarations', (id) => {
    const { styles } = routes.get(id)!;
    for (const entry of styles.table) {
      expect(deriveStyleId(entry.declarations)).toBe(entry.styleId);
    }
  });

  it.each([...routes.keys()])('%s: every a11y ref is derived from route and node', (id) => {
    const { dom } = routes.get(id)!;
    for (const el of elements(dom).values()) {
      if (el.a11y) expect(deriveA11yRef(id, el.nodeId)).toBe(el.a11y.ref);
    }
  });

  it.each([...routes.keys()])('%s: routeId is derived from pattern, instance, and viewport', (id) => {
    const { meta } = routes.get(id)!;
    expect(deriveRouteId(meta.urlPattern, meta.instanceIndex, meta.viewport)).toBe(id);
  });

  it('excludes unstable classnames from the fingerprint (§11)', () => {
    // Two nodes differing only by class must fingerprint identically, or a
    // CSS-in-JS rebuild changes every nodeId on the page.
    const base = { tag: 'div', attributes: { id: 'x', class: 'css-1a2b3c' }, text: 'hello' };
    const rebuilt = { tag: 'div', attributes: { id: 'x', class: 'css-9z8y7x' }, text: 'hello' };
    expect(deriveContentFingerprint(base)).toBe(deriveContentFingerprint(rebuilt));
    // …but a genuine content change must not collide.
    expect(deriveContentFingerprint(base)).not.toBe(
      deriveContentFingerprint({ ...base, text: 'goodbye' }),
    );
  });

  it('canonicalises declarations so property order cannot fork the table', () => {
    const a = { color: 'rgb(0, 0, 0)', display: 'block' };
    const b = { display: 'block', color: 'rgb(0, 0, 0)' };
    expect(canonicalizeStyleDeclarations(a)).toBe(canonicalizeStyleDeclarations(b));
    expect(deriveStyleId(a)).toBe(deriveStyleId(b));
  });
});

/* ---------------------------------------------------------- route identity */

describe('route identity (decision 0002)', () => {
  it('routeId encodes pattern, instance, and viewport consistently', () => {
    for (const [id, r] of routes) {
      const [, instance, viewport] = id.split('--');
      expect(instance).toBe(`i${r.meta.instanceIndex}`);
      expect(viewport).toBe(`${r.meta.viewport.width}x${r.meta.viewport.height}`);
    }
  });

  it('every route in a pattern group agrees on the pattern', () => {
    for (const group of manifest.patterns) {
      for (const routeId of group.routeIds) {
        expect(routes.get(routeId)!.meta.urlPattern).toBe(group.urlPattern);
      }
      expect(group.routeIds.length).toBeLessThanOrEqual(manifest.crawl.maxInstancesPerPattern * manifest.viewports.length);
    }
    expect(manifest.patterns.flatMap((p) => p.routeIds).sort()).toEqual([...routes.keys()].sort());
  });

  it('honours the §6 instance cap per (pattern, viewport)', () => {
    const seen = new Map<string, number>();
    for (const r of routes.values()) {
      const key = `${r.meta.urlPattern}@${r.meta.viewport.width}x${r.meta.viewport.height}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, n] of seen) {
      expect(n, `${key} exceeds the instance cap`).toBeLessThanOrEqual(manifest.crawl.maxInstancesPerPattern);
    }
  });

  it('keeps the /product/:id instances structurally alike but textually different (§7.2)', () => {
    const a = routes.get('product-id--i0--1280x800')!;
    const b = routes.get('product-id--i1--1280x800')!;
    const pathsOf = (d: DomDocument): string[] =>
      [...elements(d).values()].map((e) => e.identity.structuralPath).sort();
    expect(pathsOf(a.dom)).toEqual(pathsOf(b.dom));
    // Same structure, different content — the exact signal §7.2 extracts components from.
    expect(a.dom.domHash).not.toBe(b.dom.domHash);
  });

  it('repeats ProductCard at least three times on the home route (§7.2)', () => {
    const homeDom = routes.get('root--i0--1280x800')!.dom;
    const cards = [...elements(homeDom).values()].filter((e) =>
      (e.attributes['class'] ?? '').includes('product-card'),
    );
    expect(cards.length).toBeGreaterThanOrEqual(3);
    const shapes = new Set(
      cards.map((c) => c.children.filter((k) => k.nodeType === 'element').map((k) => (k as { tag: string }).tag).join('>')),
    );
    expect(shapes.size).toBe(1);
  });

  it('records the redirect-to-login behaviour for the auth-gated route (§6, M6)', () => {
    const secured = [...routes.values()].filter((r) => r.meta.requiresAuth);
    expect(secured.length).toBeGreaterThan(0);
    for (const r of secured) {
      expect(r.meta.authState).toBe('authenticated');
      expect(r.meta.unauthenticatedBehavior.kind).toBe('redirect');
    }
    for (const r of routes.values()) {
      if (!r.meta.requiresAuth) expect(r.meta.unauthenticatedBehavior.kind).toBe('accessible');
    }
  });
});

/* -------------------------------------------------------- manifest coherence */

describe('manifest coherence', () => {
  it('lists exactly the routes and flows on disk', () => {
    expect([...manifest.routeIds].sort()).toEqual([...routes.keys()].sort());
    expect([...manifest.flowIds].sort()).toEqual([...flows.keys()].sort());
    expect(manifest.counts.routes).toBe(routes.size);
    expect(manifest.counts.flows).toBe(flows.size);
    expect(manifest.counts.assets).toBe(Object.keys(assets.byUrl).length);
    expect(manifest.counts.endpoints).toBe(endpoints.endpoints.length);
    expect(manifest.counts.gaps).toBe(report.gaps.length);
    expect(manifest.counts.patterns).toBe(manifest.patterns.length);
  });

  it('captures every declared viewport', () => {
    const captured = new Set([...routes.values()].map((r) => `${r.meta.viewport.width}x${r.meta.viewport.height}`));
    for (const v of manifest.viewports) expect(captured.has(`${v.width}x${v.height}`)).toBe(true);
  });

  it('and captures nothing at an undeclared viewport, unless it is an embed', () => {
    const declared = new Set(manifest.viewports.map((v) => `${v.width}x${v.height}`));
    for (const [id, r] of routes) {
      const vp = `${r.meta.viewport.width}x${r.meta.viewport.height}`;
      if (declared.has(vp)) continue;
      // The only licence for an undeclared viewport is a frame content box (§11).
      expect(r.meta.embeddedIn.length, `${id} renders at ${vp}, which no viewport declares`).toBeGreaterThan(0);
      expect(r.meta.viewport.width).toBe(r.meta.embeddedIn[0]!.contentBox.width);
      expect(r.meta.viewport.height).toBe(r.meta.embeddedIn[0]!.contentBox.height);
    }
  });

  it('freezes all four globals §6 requires', () => {
    expect(manifest.determinism.frozen).toEqual(
      expect.arrayContaining(['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID']),
    );
    expect(manifest.determinism.prefersReducedMotion).toBe('reduce');
  });

  it('reports every written artifact as a stage output', () => {
    const outputs = new Set(report.outputs.map((o) => o.path));
    for (const id of routes.keys()) {
      for (const f of ['meta', 'dom', 'styles', 'states']) expect(outputs.has(`routes/${id}/${f}.json`)).toBe(true);
    }
    expect(outputs.has('assets/index.json')).toBe(true);
    expect(outputs.has('network/endpoints.json')).toBe(true);
    expect(report.status).toBe('ok-with-gaps');
  });
});

/* --------------------------------------------------- idempotency + safety */

describe('idempotency and safety', () => {
  it('confines every volatile field to provenance (M1: idempotent modulo timestamps)', () => {
    expect(VOLATILE_ARTIFACT_KEYS).toEqual(['provenance']);
    const raw = readFileSync(join(ROOT, 'manifest.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Stripping provenance must leave nothing that changes between two crawls.
    const { provenance, ...stable } = parsed;
    expect(provenance).toBeDefined();
    expect(JSON.stringify(stable)).not.toMatch(/recordedAt|durationMs|run_[0-9a-f]{16}/);
  });

  it('recomputes the manifest contentHash from the content artifacts', async () => {
    const { createHash } = await import('node:crypto');
    const canon = (v: unknown): string => {
      if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
      }
      return JSON.stringify(v) ?? 'null';
    };
    const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
    const stable = (a: unknown): string => {
      const copy = { ...(a as Record<string, unknown>) };
      for (const k of VOLATILE_ARTIFACT_KEYS) delete copy[k];
      return sha(canon(copy));
    };

    const lines: string[] = [];
    for (const [id, r] of routes) {
      lines.push(`routes/${id}/meta.json:${stable(read(`routes/${id}/meta.json`))}`);
      lines.push(`routes/${id}/dom.json:${stable(read(`routes/${id}/dom.json`))}`);
      lines.push(`routes/${id}/styles.json:${stable(read(`routes/${id}/styles.json`))}`);
      lines.push(`routes/${id}/states.json:${stable(read(`routes/${id}/states.json`))}`);
      void r;
    }
    lines.push(`assets/index.json:${stable(read('assets/index.json'))}`);
    lines.push(`network/endpoints.json:${stable(read('network/endpoints.json'))}`);
    for (const f of flowFiles) lines.push(`flows/${f}:${stable(read(`flows/${f}`))}`);

    expect(sha(lines.sort().join('\n'))).toBe(manifest.contentHash);
  });

  it('contains no credential-shaped content (§3.3, §3.4)', () => {
    const files = [
      'manifest.json', 'stage-report.json', 'assets/index.json', 'network/endpoints.json',
      ...flowFiles.map((f) => `flows/${f}`),
      ...[...routes.keys()].flatMap((id) =>
        ['meta', 'dom', 'styles', 'states'].map((n) => `routes/${id}/${n}.json`)),
    ];
    const forbidden: [RegExp, string][] = [
      [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'an email address'],
      [/\bBearer\s+[A-Za-z0-9._-]{10,}/i, 'a bearer token'],
      [/\beyJ[A-Za-z0-9._-]{20,}/, 'a JWT'],
      [/"(?:password|passwd|secret|api[_-]?key|access[_-]?token|session[_-]?id)"\s*:\s*"[^"]+"/i, 'a credential value'],
      [/\bset-cookie\b/i, 'a Set-Cookie header'],
    ];
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      for (const [pattern, what] of forbidden) {
        expect(pattern.test(text), `${file} appears to contain ${what}`).toBe(false);
      }
    }
  });

  it('records credential-bearing headers by name and sensitivity only', () => {
    for (const endpoint of endpoints.endpoints) {
      for (const header of endpoint.params.headers) {
        expect(Object.keys(header).sort()).toEqual(['name', 'required', 'sensitive']);
      }
    }
    const login = endpoints.endpoints.find((e) => e.endpointId === 'post-api-auth-login')!;
    // The request schema may describe a password field; no sample may carry one.
    for (const sample of login.samples) {
      expect(JSON.stringify(sample.body)).not.toMatch(/password/i);
    }
  });

  it('never records the storage state itself, only its path (§3.3, §5)', () => {
    expect(manifest.auth.mode).toBe('storage-state');
    if (manifest.auth.mode === 'storage-state') {
      expect(manifest.auth.storageStatePath).toBe('auth/storage-state.json');
      expect(Object.keys(manifest.auth)).not.toContain('cookies');
    }
  });
});
