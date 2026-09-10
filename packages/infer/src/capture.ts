/**
 * Reading a capture directory, and nothing else.
 *
 * §4's stage contract: every stage reads and writes files on disk, and holds no
 * state across stages. So infer's whole input is this — parsed through the
 * schema that produced it, because a capture that does not validate is a
 * capture whose producer changed underneath us, and inferring from it would
 * turn a schema drift into a quiet wrong model.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CaptureManifestSchema,
  DomDocumentSchema,
  EndpointIndexSchema,
  RouteMetaSchema,
  StateDeltasDocumentSchema,
  StyleSheetDocumentSchema,
  type CaptureManifest,
  type DomDocument,
  type EndpointIndex,
  type RouteMeta,
  type StateDeltasDocument,
  type StyleSheetDocument,
  SkippedControlIndexSchema,
  type SkippedControlIndex,
} from '@siteforge/schema';

export interface CapturedRoute {
  readonly routeId: string;
  readonly meta: RouteMeta;
  readonly dom: DomDocument;
  readonly styles: StyleSheetDocument;
  readonly states: StateDeltasDocument;
}

export interface Capture {
  readonly root: string;
  readonly manifest: CaptureManifest;
  readonly endpoints: EndpointIndex;
  readonly routes: readonly CapturedRoute[];
  /**
   * §7.6's input. **Absent, not empty, when the probe pass did not run** — a
   * read-only crawl writes no `flows/`, and `controls: []` would say "the pass
   * ran and skipped nothing", which is the opposite claim. 0019's rule: the two
   * must not render identically.
   */
  readonly skippedControls: SkippedControlIndex | null;
}

export class CaptureReadError extends Error {}

const read = <T>(path: string, schema: { parse: (v: unknown) => T }, what: string): T => {
  if (!existsSync(path)) {
    throw new CaptureReadError(`${what} is missing at ${path}. Run the capture stage first.`);
  }
  return schema.parse(JSON.parse(readFileSync(path, 'utf8')));
};

/** Read and validate a capture. Throws rather than inferring from a partial one. */
export function readCapture(root: string): Capture {
  const manifest = read(join(root, 'manifest.json'), CaptureManifestSchema, 'the capture manifest');
  const endpoints = read(
    join(root, 'network', 'endpoints.json'),
    EndpointIndexSchema,
    'the endpoint index',
  );
  const skippedPath = join(root, 'flows', 'skipped-controls.json');
  const skippedControls = existsSync(skippedPath)
    ? SkippedControlIndexSchema.parse(JSON.parse(readFileSync(skippedPath, 'utf8')))
    : null;
  const routesDir = join(root, 'routes');
  const routes: CapturedRoute[] = existsSync(routesDir)
    ? readdirSync(routesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .map((routeId) => ({
          routeId,
          meta: read(join(routesDir, routeId, 'meta.json'), RouteMetaSchema, `route ${routeId}`),
          dom: read(join(routesDir, routeId, 'dom.json'), DomDocumentSchema, `dom for ${routeId}`),
          styles: read(
            join(routesDir, routeId, 'styles.json'),
            StyleSheetDocumentSchema,
            `styles for ${routeId}`,
          ),
          states: read(
            join(routesDir, routeId, 'states.json'),
            StateDeltasDocumentSchema,
            `states for ${routeId}`,
          ),
        }))
    : [];
  return { root, manifest, endpoints, routes, skippedControls };
}
