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

/** The four files under one `routes/<route-id>/` directory. */
export const RouteCaptureSchema = z
  .strictObject({
    meta: RouteMetaSchema,
    dom: DomDocumentSchema,
    styles: StyleSheetDocumentSchema,
    states: StateDeltasDocumentSchema,
  })
  .superRefine((route, ctx) => {
    // Four files in one directory that disagree about which route they describe
    // is the exact drift §13 warns about. Catch it at load, not at codegen.
    const id = route.meta.routeId;
    for (const key of ['dom', 'styles', 'states'] as const) {
      if (route[key].routeId !== id) {
        ctx.addIssue({
          code: 'custom',
          path: [key, 'routeId'],
          message: `${key}.json claims route ${route[key].routeId} but sits in ${id}`,
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
  })
  .superRefine((model, ctx) => {
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
