/**
 * `CaptureModel` — the §5 artifact set, assembled.
 *
 * This is the type that "ties them together" (the operator's M0 brief). It is a
 * **logical** aggregate, not a file: §4's stage contract says "each stage reads
 * and writes files on disk only. No stage may hold state in memory across
 * stages." Nothing writes a `capture-model.json`. A loader walks the directory
 * and produces one of these; `capture` writes the parts, `infer` reads them.
 *
 * Naming: this is the §5 layer, deliberately not called `SiteModel` — see
 * docs/decisions/0001-sitemodel-is-two-layers.md. `SiteModel` is reserved for
 * §7's inference output, which is what §4's package table says flows into codegen.
 */
import { z } from 'zod';
import { FlowIdSchema, RouteIdSchema, SiteIdSchema } from './primitives.js';
import { deriveRouteContentHash } from './artifact.js';
import { CAPTURE_MODEL_VERSION } from './version.js';
import { CaptureManifestSchema } from './manifest.js';
import { RouteMetaSchema } from './route.js';
import { DomDocumentSchema, type DomNode } from './dom.js';
import { StyleSheetDocumentSchema } from './styles.js';
import { StateDeltasDocumentSchema } from './states.js';
import { AssetIndexSchema } from './assets.js';
import { EndpointIndexSchema } from './endpoints.js';
import { FlowTraceSchema } from './flows.js';
import { StageReportSchema } from './stage-report.js';
import { CoverageReportSchema } from './coverage.js';

/**
 * The files under one `routes/<route-id>/` directory.
 *
 * `dom` / `styles` / `states` are present exactly when `meta.content.kind` is
 * `'captured'`. A `'shared'` route holds only `meta.json` and points at the route
 * that stores the artifacts — see `RouteContentSchema`.
 */
export const RouteCaptureSchema = z
  .strictObject({
    meta: RouteMetaSchema,
    dom: DomDocumentSchema.optional(),
    styles: StyleSheetDocumentSchema.optional(),
    states: StateDeltasDocumentSchema.optional(),
  })
  .superRefine((route, ctx) => {
    const shared = route.meta.content.kind === 'shared';
    for (const key of ['dom', 'styles', 'states'] as const) {
      if (shared && route[key] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key}.json must not exist: this route shares content with ${
            route.meta.content.kind === 'shared' ? route.meta.content.canonicalRouteId : ''
          }`,
        });
      }
      if (!shared && route[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key}.json is missing from a captured route`,
        });
      }
    }
    if (shared) return;
    // Four files in one directory that disagree about which route they describe
    // is the exact drift §13 warns about. Catch it at load, not at codegen.
    const id = route.meta.routeId;
    for (const key of ['dom', 'styles', 'states'] as const) {
      const artifact = route[key];
      if (artifact && artifact.routeId !== id) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'routeId'],
          message: `${key}.json claims route ${artifact.routeId} but sits in ${id}`,
        });
      }
    }
    if (!route.dom || !route.styles) return;

    // The recorded content hash must be the one the artifacts actually produce,
    // or the shared-content pointer would deduplicate pages that are not equal.
    if (route.states) {
      const actual = deriveRouteContentHash({ dom: route.dom, styles: route.styles, states: route.states });
      if (actual !== route.meta.content.contentHash) {
        ctx.addIssue({
          code: 'custom',
          path: ['meta', 'content', 'contentHash'],
          message: `recorded ${route.meta.content.contentHash.slice(0, 12)}… but the artifacts hash to ${actual.slice(0, 12)}…`,
        });
      }
    }

    // `styles.assignments` is authoritative; `DomElementNode.styleId` mirrors it.
    // Two copies of one mapping is exactly the schema-permitted drift §13 warns
    // about, so the disagreement is rejected here rather than left to a test.
    const assignments = route.styles.assignments as Record<string, string | undefined>;
    const visit = (node: DomNode): void => {
      if (node.nodeType !== 'element') return;
      const assigned = assignments[node.nodeId];
      if (assigned === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['styles', 'assignments', node.nodeId],
          message: `element ${node.nodeId} in dom.json has no style assignment`,
        });
      } else if (assigned !== node.styleId) {
        ctx.addIssue({
          code: 'custom',
          path: ['dom', 'root', node.nodeId, 'styleId'],
          message: `element ${node.nodeId} says ${node.styleId} but styles.json assigns ${assigned}`,
        });
      }
      node.children.forEach(visit);
    };
    visit(route.dom.root);
  });

export const CaptureModelSchema = z
  .strictObject({
    modelVersion: z.literal(CAPTURE_MODEL_VERSION),
    siteId: SiteIdSchema,
    manifest: CaptureManifestSchema,
    /** Keyed by the composite route id (decision 0002). */
    routes: z.record(RouteIdSchema, RouteCaptureSchema),
    assets: AssetIndexSchema,
    endpoints: EndpointIndexSchema,
    flows: z.record(FlowIdSchema, FlowTraceSchema),
    /** Absent while a capture is still in progress. */
    stageReport: StageReportSchema.optional(),
    /** Input-vs-output contradiction check. Absent while a capture is in progress. */
    coverage: CoverageReportSchema.optional(),
  })
  .superRefine((model, ctx) => {
    const contexts = new Map(model.manifest.contexts.map((c) => [c.contextId, c]));
    const routes = Object.entries(model.routes);

    // Every route resolves to a declared context, and its rendered size agrees
    // with either that context's viewport or the frame box that embedded it.
    for (const [routeId, route] of routes) {
      const context = contexts.get(route.meta.contextId);
      if (!context) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'contextId'],
          message: `context ${route.meta.contextId} is not declared in the manifest`,
        });
        continue;
      }
      if (!routeId.includes(`--${route.meta.contextId}--`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'contextId'],
          message: `routeId does not encode context ${route.meta.contextId}`,
        });
      }
      if (route.meta.content.kind !== 'captured') continue;
      const { renderedSize } = route.meta.content;
      const embed = route.meta.embeddedIn[0];
      const expected = embed
        ? { width: embed.contentBox.width, height: embed.contentBox.height }
        : { width: context.viewport.width, height: context.viewport.height };
      if (renderedSize.width !== expected.width || renderedSize.height !== expected.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'renderedSize'],
          message: embed
            ? 'an embedded route must render at its frame content box'
            : `a top-level route must render at context ${context.contextId}'s viewport`,
        });
      }
    }

    // Shared content must point at a route that actually holds the artifacts,
    // with the same hash, and must not chain.
    for (const [routeId, route] of routes) {
      if (route.meta.content.kind !== 'shared') continue;
      const { canonicalRouteId, contentHash } = route.meta.content;
      if (canonicalRouteId === routeId) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'canonicalRouteId'],
          message: 'a route cannot share content with itself',
        });
        continue;
      }
      const canonical = model.routes[canonicalRouteId];
      if (!canonical) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'canonicalRouteId'],
          message: `${canonicalRouteId} does not exist`,
        });
        continue;
      }
      if (canonical.meta.content.kind !== 'captured') {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'canonicalRouteId'],
          message: `${canonicalRouteId} is itself shared; pointers must not chain`,
        });
        continue;
      }
      if (canonical.meta.content.contentHash !== contentHash) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'contentHash'],
          message: `does not match ${canonicalRouteId}, so the content is not actually shared`,
        });
      }
      if (canonical.meta.url !== route.meta.url) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', routeId, 'meta', 'content', 'canonicalRouteId'],
          message: 'shared content must come from the same URL',
        });
      }
    }

    // §6's caps, applied per context with a global ceiling (decision 0004).
    const { budget } = model.manifest.crawl;
    const perContext = new Map<string, number>();
    const perPatternContext = new Map<string, number>();
    for (const route of Object.values(model.routes)) {
      const contextId = route.meta.contextId;
      perContext.set(contextId, (perContext.get(contextId) ?? 0) + 1);
      const key = `${route.meta.urlPattern}@${contextId}`;
      perPatternContext.set(key, (perPatternContext.get(key) ?? 0) + 1);
      if (route.meta.depth > budget.maxDepth) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', route.meta.routeId, 'meta', 'depth'],
          message: `depth ${route.meta.depth} exceeds maxDepth ${budget.maxDepth}`,
        });
      }
    }
    for (const [key, count] of perPatternContext) {
      if (count > budget.maxInstancesPerPattern) {
        ctx.addIssue({
          code: 'custom',
          path: ['manifest', 'crawl', 'budget', 'maxInstancesPerPattern'],
          message: `${key} has ${count} instances, over the cap of ${budget.maxInstancesPerPattern}`,
        });
      }
    }
    for (const [contextId, count] of perContext) {
      if (count > budget.maxRoutesPerContext) {
        ctx.addIssue({
          code: 'custom',
          path: ['manifest', 'crawl', 'budget', 'maxRoutesPerContext'],
          message: `context ${contextId} captured ${count} routes, over the cap of ${budget.maxRoutesPerContext}`,
        });
      }
    }
    if (routes.length > budget.maxRoutesTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['manifest', 'crawl', 'budget', 'maxRoutesTotal'],
        message: `${routes.length} routes exceeds the global ceiling of ${budget.maxRoutesTotal}`,
      });
    }

    // §1/§7: a gap that is referenced but never written is a gap that never
    // reaches GAPS.md, which is the whole failure the gap machinery prevents.
    //
    // Collected unconditionally. `stageReport` is optional because a capture in
    // progress has not written one yet — but that must not become a way to
    // reference gaps nothing will ever define.
    const referencedGaps = new Map<string, string>();
    const note = (gapId: string | undefined, where: string): void => {
      if (gapId) referencedGaps.set(gapId, where);
    };
    for (const [routeId, route] of routes) {
      for (const gapId of route.meta.gapIds) note(gapId, `routes/${routeId}/meta.json`);
      const walkDom = (node: DomNode): void => {
        if (node.nodeType !== 'element') return;
        if (node.iframe && !node.iframe.sameOrigin) note(node.iframe.gapId, `routes/${routeId} iframe`);
        if (node.shadowHost?.mode === 'closed') note(node.shadowHost.gapId, `routes/${routeId} closed shadow root`);
        node.children.forEach(walkDom);
      };
      if (route.dom) walkDom(route.dom.root);
    }
    for (const flow of Object.values(model.flows)) {
      for (const gapId of flow.gapIds) note(gapId, `flows/${flow.flowId}`);
      note(flow.skipReason?.gapId, `flows/${flow.flowId} skipReason`);
    }
    for (const endpoint of model.endpoints.endpoints) {
      note(endpoint.stub?.gapId, `endpoint ${endpoint.endpointId}`);
    }
    for (const origin of model.endpoints.thirdPartyOrigins) note(origin.gapId, `third-party ${origin.origin}`);

    if (!model.stageReport) {
      if (referencedGaps.size > 0) {
        const [gapId, where] = [...referencedGaps][0]!;
        ctx.addIssue({
          code: 'custom',
          path: ['stageReport'],
          message:
            `${where} references ${gapId}, but there is no stage report to define it. ` +
            'A model that names gaps must carry the report that writes them.',
        });
      }
    } else {
      const defined = new Set(model.stageReport.gaps.map((g) => g.gapId));
      for (const [gapId, where] of referencedGaps) {
        if (!defined.has(gapId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['stageReport', 'gaps'],
            message: `${where} references ${gapId}, which the stage report never defines`,
          });
        }
      }
    }

    // A failed coverage invariant means extraction silently dropped something the
    // input contained. That is a failed run, not a warning — otherwise the whole
    // mechanism is advisory and the next silent drop ships.
    if (model.coverage) {
      const broken = model.coverage.invariants.filter((i) => !i.vacuous && !i.holds);
      if (broken.length > 0 && model.stageReport && model.stageReport.status !== 'failed') {
        ctx.addIssue({
          code: 'custom',
          path: ['stageReport', 'status'],
          message:
            `coverage invariant ${broken[0]!.id} does not hold (${broken[0]!.description}), ` +
            `so the stage status must be 'failed', not '${model.stageReport.status}'`,
        });
      }
      const routeIds = new Set(Object.keys(model.routes));
      for (const routeId of model.coverage.routeIds) {
        if (!routeIds.has(routeId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['coverage', 'routeIds'],
            message: `coverage aggregates route ${routeId}, which was not loaded`,
          });
        }
      }
    }

    if (model.manifest.siteId !== model.siteId) {
      ctx.addIssue({
        code: 'custom',
        path: ['manifest', 'siteId'],
        message: 'manifest siteId disagrees with the capture directory',
      });
    }
    const present = Object.keys(model.routes).sort();
    const declared = [...model.manifest.routeIds].sort();
    for (const id of declared) {
      if (!present.includes(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['routes', id],
          message: `manifest lists route ${id} but no route directory was loaded`,
        });
      }
    }
    for (const id of present) {
      if (!declared.includes(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['manifest', 'routeIds'],
          message: `route ${id} was loaded but the manifest does not list it`,
        });
      }
    }
  });

export type RouteCapture = z.infer<typeof RouteCaptureSchema>;
export type CaptureModel = z.infer<typeof CaptureModelSchema>;
