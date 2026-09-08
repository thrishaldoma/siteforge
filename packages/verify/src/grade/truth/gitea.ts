/**
 * The ground truth: a Gitea someone else wrote, read from a digest-pinned
 * snapshot.
 *
 * Decision 0015 §1. Not the rung-3 CRUD app — we wrote that server, so grading
 * against it measures whether infer agrees with the model already in our heads,
 * which is exactly why generated fixtures could not validate capture.
 *
 * Two things this loader is careful about, both of them §13 rules applied to a
 * grader's truth side rather than to an invariant's observed side:
 *
 * 1. **Paths are parsed, never string-matched.** `/api/v1/repos` and
 *    `/api/v1/repos-archive` differ by a segment boundary a prefix test cannot
 *    see, and that class of bug has cost this repo five occurrences across five
 *    grammars. Shapes are built by splitting on `/` and normalising each
 *    parameter segment positionally.
 * 2. **A truth that failed to load throws.** §6 makes *category* vacuity a
 *    scored outcome, deliberately not an exception — but that is about a
 *    denominator nobody exercised, not about a truth file that is missing or
 *    thin. A grader whose ground truth did not load must report nothing at all,
 *    because every number it could produce would be about the empty set.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GradeCategoryId } from '@siteforge/schema';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `src/grade/truth` and `dist/grade/truth` are the same depth from the package root. */
const FIXTURES = join(HERE, '..', '..', '..', 'fixtures', 'gitea');

export class TruthLoadError extends Error {
  override readonly name = 'TruthLoadError';
}

/**
 * What the pinned server does about credentials, which is **not** what the
 * document says (§4).
 *
 * `indeterminate` is a real outcome and is counted, never folded into one of the
 * decided ones: §13's rule that a classifier which cannot decide must say so.
 */
export type TruthAuth = 'required' | 'not-required' | 'indeterminate' | 'unobserved';

/**
 * One addressable field claim in the truth.
 *
 * `pointer` is RFC 6901 over the *value*, with `/[]` for an array element —
 * `/[]/owner/login` is the login of the owner of each item in a list response.
 * The convention is fixed here because it is one of the things the scored-field
 * list forces onto SiteModel rather than the other way round (0015 §0).
 */
export interface TruthField {
  readonly pointer: string;
  readonly type: string;
  readonly format: string | null;
  readonly enumValues: readonly string[] | null;
  readonly required: boolean;
}

export interface TruthResponseField extends TruthField {
  readonly status: string;
}

export interface TruthEndpoint {
  readonly method: string;
  /** As written in the document, relative to `basePath`. */
  readonly specPath: string;
  /** `basePath` + `specPath`. */
  readonly fullPath: string;
  /** §2's matching key: every parameter segment normalised to a positional hole. */
  readonly shape: string;
  /** Parameter names in order. Scored (§3), never matched on. */
  readonly paramNames: readonly string[];
  readonly operationId: string;
  readonly requestFields: readonly TruthField[];
  readonly responseFields: readonly TruthResponseField[];
  readonly auth: TruthAuth;
  /** The status the pinned server returned to an uncredentialed request. */
  readonly authEvidence: { readonly anonymousStatus: number | null } | null;
}

export interface TruthModel {
  readonly image: string;
  readonly specSha256: string;
  readonly basePath: string;
  readonly endpoints: readonly TruthEndpoint[];
  readonly counts: {
    readonly paths: number;
    readonly operations: number;
    readonly definitions: number;
    readonly withPathParams: number;
    readonly authRequired: number;
    readonly authNotRequired: number;
    readonly authIndeterminate: number;
    readonly authUnobserved: number;
  };
  /**
   * Categories whose truth side this loader does not derive.
   *
   * Named rather than absent. A category with an empty truth side scores
   * `vacuous: true` and fails its gate (§6), which is the visible outcome; this
   * list is why, so the failure reads as "not built yet" rather than "infer
   * emitted nothing".
   */
  readonly notDerived: readonly GradeCategoryId[];
}

// ---------------------------------------------------------------------------

/**
 * Split a URL path into segments.
 *
 * Deliberately not `pathSegments` from `@siteforge/shared`: that one also treats
 * `\` as a separator, which is right for a filesystem path and wrong here,
 * because a backslash is a legal character in a URL path (0014's open list).
 */
const urlPathSegments = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

const isParameterSegment = (segment: string): boolean =>
  (segment.startsWith('{') && segment.endsWith('}')) || segment.startsWith(':');

const parameterName = (segment: string): string =>
  segment.startsWith(':') ? segment.slice(1) : segment.slice(1, -1);

/**
 * §2's matching key: `(method, positionally-normalised path shape)`.
 *
 * `/repos/{owner}/{repo}/issues` and `/repos/:owner/:repo/issues` both become
 * `repos/*​/*​/issues`, so a spelling difference between a document and a
 * crawler is not a miss, while an arity difference still is.
 */
export function pathShape(path: string): string {
  return urlPathSegments(path)
    .map((segment) => (isParameterSegment(segment) ? '*' : segment))
    .join('/');
}

export function pathParameterNames(path: string): string[] {
  return urlPathSegments(path).filter(isParameterSegment).map(parameterName);
}

// ---------------------------------------------------------------------------
// Swagger 2.0 field enumeration
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/**
 * How deep a response shape is enumerated. Gitea nests repo→owner→…
 *
 * Exported because the model-side walker in `../fields.ts` must use the same
 * number. The depth is not a property of either walker — it is the boundary of
 * what the two sides can be compared over, and two cut-offs would charge infer
 * for fields this side declined to enumerate.
 */
export const MAX_FIELD_DEPTH = 4;

const asObject = (value: unknown): Json | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;

/**
 * Resolve one `$ref` against the document.
 *
 * Only local refs exist in this document; a remote one is a defect rather than
 * something to fall back from, so it throws.
 */
function resolveRef(spec: Json, ref: string): Json {
  const segments = ref.split('/');
  if (segments.shift() !== '#') throw new TruthLoadError(`non-local $ref in the ground truth: ${ref}`);
  let node: unknown = spec;
  for (const segment of segments) {
    const object = asObject(node);
    if (object === null) throw new TruthLoadError(`$ref ${ref} does not resolve`);
    node = object[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  const resolved = asObject(node);
  if (resolved === null) throw new TruthLoadError(`$ref ${ref} resolves to a non-object`);
  return resolved;
}

const deref = (spec: Json, node: Json, seen: ReadonlySet<string>): { node: Json; seen: Set<string> } => {
  let current = node;
  const visited = new Set(seen);
  while (typeof current['$ref'] === 'string') {
    const ref = current['$ref'];
    // A cycle is not an error in a schema — Gitea's `Repository.parent` is a
    // Repository. It is a place to stop, and stopping silently at a fixed depth
    // is what keeps the truth finite without pretending the field is absent.
    if (visited.has(ref)) return { node: {}, seen: visited };
    visited.add(ref);
    current = resolveRef(spec, ref);
  }
  return { node: current, seen: visited };
};

function walkSchema(
  spec: Json,
  schema: Json,
  pointer: string,
  depth: number,
  seen: ReadonlySet<string>,
  out: TruthField[],
  requiredHere: boolean,
): void {
  if (depth > MAX_FIELD_DEPTH) return;
  const { node, seen: visited } = deref(spec, schema, seen);
  const type = typeof node['type'] === 'string' ? (node['type'] as string) : 'object';

  if (pointer !== '') {
    out.push({
      pointer,
      type,
      format: typeof node['format'] === 'string' ? (node['format'] as string) : null,
      enumValues: Array.isArray(node['enum']) ? (node['enum'] as unknown[]).map(String) : null,
      required: requiredHere,
    });
  }

  if (type === 'array') {
    const items = asObject(node['items']);
    if (items !== null) walkSchema(spec, items, `${pointer}/[]`, depth + 1, visited, out, false);
    return;
  }
  const properties = asObject(node['properties']);
  if (properties === null) return;
  const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
  for (const [name, child] of Object.entries(properties)) {
    const childObject = asObject(child);
    if (childObject === null) continue;
    const escaped = name.replace(/~/g, '~0').replace(/\//g, '~1');
    walkSchema(spec, childObject, `${pointer}/${escaped}`, depth + 1, visited, out, required.has(name));
  }
}

function requestFields(spec: Json, operation: Json): TruthField[] {
  const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
  const out: TruthField[] = [];
  for (const raw of parameters) {
    const parameter = asObject(raw);
    if (parameter === null || parameter['in'] !== 'body') continue;
    const schema = asObject(parameter['schema']);
    if (schema === null) continue;
    walkSchema(spec, schema, '', 0, new Set(), out, parameter['required'] === true);
  }
  return out;
}

function responseFields(spec: Json, operation: Json): TruthResponseField[] {
  const responses = asObject(operation['responses']);
  if (responses === null) return [];
  const out: TruthResponseField[] = [];
  for (const [status, raw] of Object.entries(responses)) {
    const response = asObject(raw);
    if (response === null) continue;
    const { node } = deref(spec, response, new Set());
    const schema = asObject(node['schema']);
    if (schema === null) continue;
    const fields: TruthField[] = [];
    walkSchema(spec, schema, '', 0, new Set(), fields, false);
    for (const field of fields) out.push({ ...field, status });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth, measured
// ---------------------------------------------------------------------------

/**
 * The pinned server's answer to an uncredentialed request, classified.
 *
 * **404 is `required`, never "absent".** Gitea answers 404 rather than 403 for
 * resources it will not confirm exist to an anonymous caller, so reading 404 as
 * "this endpoint is not real" would delete a gated endpoint from the truth set
 * and convert a correct inference into a hallucination — a wrong answer in a
 * second category, caused by a default chosen in this one. §13: when a
 * classifier cannot decide, the default is the safe one *for that category*.
 */
export function classifyAnonymousStatus(status: number | null): TruthAuth {
  if (status === null) return 'indeterminate';
  if (status === 200) return 'not-required';
  if (status === 401 || status === 403 || status === 404) return 'required';
  return 'indeterminate';
}

// ---------------------------------------------------------------------------

export interface Snapshot {
  readonly spec: Json;
  readonly pin: Json;
  readonly probe: Json;
  readonly specBytes: Buffer;
}

function readSnapshot(root: string): Snapshot {
  const readJson = (name: string): { json: Json; bytes: Buffer } => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, name));
    } catch (err) {
      // operational: a missing snapshot is an environment problem with one
      // instruction attached, not a defect to stack-trace.
      throw new TruthLoadError(
        `no ground-truth snapshot at ${join(root, name)}. Run \`node packages/verify/scripts/gitea-snapshot.mjs --write\` against the pinned image.`,
      );
    }
    const parsed = asObject(JSON.parse(bytes.toString('utf8')));
    if (parsed === null) throw new TruthLoadError(`${name} is not a JSON object`);
    return { json: parsed, bytes };
  };
  const spec = readJson('swagger.v1.json');
  return {
    spec: spec.json,
    specBytes: spec.bytes,
    pin: readJson('pin.json').json,
    probe: readJson('anon-probe.json').json,
  };
}

/**
 * Build the truth from a snapshot already in memory, or throw.
 *
 * Separated from the file reading so the floors take their input as a parameter.
 * They are the part worth exercising and the part hardest to reach: against the
 * committed snapshot they never fire, so a floor that had been silently
 * inverted would read exactly like a floor that works. A test hands this a
 * deliberately thin document and watches each one object.
 *
 * The floors **throw**, and that is not an oversight about purity. §6 draws the
 * line deliberately: *category* vacuity is a scored outcome, because a
 * denominator nobody exercised is information. A truth that did not load is not
 * — every number computed from it would be about the empty set, so there is
 * nothing to report and the run stops.
 *
 * They are deliberately far below the measured surface (308 paths, 482
 * operations, 13 public / 37 gated zero-parameter GETs) — a floor tight enough
 * to trip on a legitimate refresh gets raised until it never fires, which is
 * how a floor becomes decoration.
 */
export function buildGiteaTruth(snapshot: Snapshot): TruthModel {
  const { spec, pin, probe, specBytes } = snapshot;

  const specSha256 = createHash('sha256').update(specBytes).digest('hex');
  if (pin['specSha256'] !== specSha256) {
    throw new TruthLoadError(
      `pin.json records ${String(pin['specSha256'])} but the spec beside it hashes to ${specSha256}. One of the two was hand-edited; re-run the snapshot script.`,
    );
  }

  const basePath = typeof pin['basePath'] === 'string' ? pin['basePath'] : '/api/v1';
  const paths = asObject(spec['paths']);
  if (paths === null) throw new TruthLoadError('the ground truth has no `paths`');

  const probeEntries = Array.isArray(probe['entries']) ? probe['entries'] : [];
  const anonymous = new Map<string, number | null>();
  for (const raw of probeEntries) {
    const entry = asObject(raw);
    if (entry === null) continue;
    const status = entry['status'];
    anonymous.set(
      `${String(entry['method'])} ${String(entry['specPath'])}`,
      typeof status === 'number' ? status : null,
    );
  }

  const METHODS = ['get', 'post', 'put', 'delete', 'patch'] as const;
  const endpoints: TruthEndpoint[] = [];
  for (const [specPath, rawItem] of Object.entries(paths)) {
    const item = asObject(rawItem);
    if (item === null) continue;
    for (const method of METHODS) {
      const operation = asObject(item[method]);
      if (operation === null) continue;
      const key = `${method.toUpperCase()} ${specPath}`;
      const observed = anonymous.has(key) ? (anonymous.get(key) ?? null) : undefined;
      endpoints.push({
        method: method.toUpperCase(),
        specPath,
        fullPath: `${basePath}${specPath}`,
        shape: pathShape(`${basePath}${specPath}`),
        paramNames: pathParameterNames(specPath),
        operationId: typeof operation['operationId'] === 'string' ? operation['operationId'] : '',
        requestFields: requestFields(spec, operation),
        responseFields: responseFields(spec, operation),
        auth: observed === undefined ? 'unobserved' : classifyAnonymousStatus(observed),
        authEvidence: observed === undefined ? null : { anonymousStatus: observed },
      });
    }
  }

  const by = (auth: TruthAuth) => endpoints.filter((e) => e.auth === auth).length;
  const counts = {
    paths: Object.keys(paths).length,
    operations: endpoints.length,
    definitions: Object.keys(asObject(spec['definitions']) ?? {}).length,
    withPathParams: endpoints.filter((e) => e.paramNames.length > 0).length,
    authRequired: by('required'),
    authNotRequired: by('not-required'),
    authIndeterminate: by('indeterminate'),
    authUnobserved: by('unobserved'),
  };

  const floors: Array<[boolean, string]> = [
    [counts.operations >= 100, `only ${counts.operations} operations loaded; the pinned image serves 482`],
    [counts.withPathParams >= 50, `only ${counts.withPathParams} operations carry a path parameter`],
    [counts.definitions >= 50, `only ${counts.definitions} definitions loaded`],
    [
      counts.authRequired >= 5,
      `the auth truth has ${counts.authRequired} gated endpoints — the anonymous sweep did not run`,
    ],
    [
      counts.authNotRequired >= 5,
      `the auth truth has ${counts.authNotRequired} public endpoints. The over-gate denominator would be zero, which §6 scores vacuous and fails — and it would score infer wrong for correctly observing a public read.`,
    ],
    [
      endpoints.some((e) => e.responseFields.length > 0),
      'no response fields were enumerated; $ref resolution is broken',
    ],
    [
      endpoints.some((e) => e.requestFields.length > 0),
      'no request fields were enumerated; body parameters are not being read',
    ],
  ];
  const broken = floors.filter(([held]) => !held).map(([, message]) => message);
  if (broken.length > 0) {
    throw new TruthLoadError(`the ground truth did not load:\n  - ${broken.join('\n  - ')}`);
  }

  return {
    image: String(pin['image'] ?? ''),
    specSha256,
    basePath,
    endpoints,
    counts,
    // `identifier`'s truth side is "foreign keys derivable from the spec", which
    // needs value-overlap reasoning the document cannot supply on its own.
    // Named here so its category fails as unbuilt rather than as infer's miss.
    notDerived: ['identifier'],
  };
}

/** The truth, read from the committed snapshot. The wiring, and nothing else. */
export function loadGiteaTruth(options: { root?: string } = {}): TruthModel {
  return buildGiteaTruth(readSnapshot(options.root ?? FIXTURES));
}
