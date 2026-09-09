/**
 * A Swagger 2.0 document, read as a ground truth.
 *
 * Target-independent: the reading, the `$ref` resolution, the field walk and
 * the anonymous-status classification are properties of the format, not of
 * whose API it describes. A target supplies a `TruthSource` — where its
 * snapshot lives, what its universe is, and the floors below which its truth
 * did not load — and nothing else.
 *
 * It was `truth/gitea.ts` until Vikunja was adopted (0019, 0021). Copying it
 * would have produced two readers drifting apart, and the half worth trusting
 * is exactly the half that has nothing to do with either target.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GradeCategoryId } from '@siteforge/schema';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `src/grade/truth` and `dist/grade/truth` are the same depth from the package root. */
const fixtureDir = (id: string): string => join(HERE, '..', '..', '..', 'fixtures', id);

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

/**
 * A definition the document declares, read as a table (0023 §2).
 *
 * `properties` is depth-1 only and includes **every** declared property —
 * scalar, object and array alike — because `FieldTypeSchema`'s `json` member
 * carries an object or an array, so every one is a claim `SiteModel` can make.
 * 0018's vocabulary rule permits excluding a claim the model cannot express and
 * never one it can, and an earlier draft that counted scalars only turned a
 * legitimate `createdBy: json` into a precision miss.
 */
export interface TruthEntity {
  /** As the document names it: `models.Task`. Never matched on (0023 §2). */
  readonly name: string;
  readonly properties: readonly TruthField[];
  /** `METHOD shape` keys of the operations whose 2xx response root it is. */
  readonly operations: readonly string[];
  /** True where every observing operation returned it as an array element. */
  readonly fromList: boolean;
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
  /**
   * The definition this operation's 2xx response carries as its row, if any.
   *
   * The pairing key for `entity-identity` (0023 §2): the model says which entity
   * an operation's rows are, the document says which definition it returns, and
   * the two are paired **through the operation** rather than by name.
   */
  readonly rowDefinition: { readonly name: string; readonly fromList: boolean } | null;
}

export interface TruthModel {
  readonly image: string;
  readonly specSha256: string;
  readonly basePath: string;
  readonly endpoints: readonly TruthEndpoint[];
  /** Definitions reachable as a 2xx response row of an endpoint above. */
  readonly entities: readonly TruthEntity[];
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
  readonly notDerived: readonly NotDerived[];
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

/**
 * Schema keywords whose presence beside `allOf` makes the wrapper a
 * composition rather than an alias.
 *
 * `description`, `title` and `example` are annotations and are not here: they
 * are exactly what the `allOf` idiom below exists to carry.
 */
const SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'items',
  'enum',
  'format',
  'required',
  'additionalProperties',
  'anyOf',
  'oneOf',
  'not',
]);

/**
 * The `$ref` behind `allOf: [{ $ref }]`, or `null` if this is not that shape.
 *
 * Swagger 2.0 has nowhere to write *"this property is that definition, and here
 * is a sentence about it"* — a sibling key beside `$ref` is undefined, so
 * generators emit the reference inside a one-member `allOf` and hang the
 * description outside it. **Measured: Vikunja's generator does this 32 times
 * and Gitea's never does**, which is why following only a bare `$ref` was
 * invisible for as long as Gitea was the target and silently wrong from the day
 * Vikunja became it. It cost the truth side every nested object reached that way
 * (`models.Task.created_by` → `user.User`, six properties) and **both** of the
 * only enum-bearing properties on a reachable definition
 * (`models.Task.repeat_mode`, `models.ProjectView.view_kind`).
 *
 * Unwrapped **only** in that exact shape: one member, a `$ref`, and no schema
 * keyword beside it. Anything else is a composition this does not implement, and
 * it **throws** rather than resolving to whatever is plausible. A truth side
 * that quietly under-claims does not report a smaller truth, it inflates every
 * recall measured against it — the failure mode is a better score, which is the
 * one nobody investigates. Silence is not a default here for the same reason it
 * is not in `UNEXPRESSIBLE_FORMATS`: neither committed document contains such a
 * node, so the throw does not fire today, and a refresh that introduces one
 * fails until somebody writes down what it means.
 */
function soleAllOfRef(node: Json): string | null {
  const members = node['allOf'];
  if (!Array.isArray(members)) return null;
  const siblings = Object.keys(node).filter((k) => k !== 'allOf' && SCHEMA_KEYWORDS.has(k));
  if (members.length !== 1 || siblings.length > 0) {
    throw new TruthLoadError(
      `a composed \`allOf\` in the ground truth: ${members.length} member(s)` +
        `${siblings.length > 0 ? ` beside ${siblings.join(', ')}` : ''}. ` +
        'Only the one-member alias form is implemented, because that is the only form either committed document uses. ' +
        'Resolving this to one member, or to the bare wrapper, would under-claim the truth side and inflate every recall scored against it — decide what it means and say so here.',
    );
  }
  const only = asObject(members[0]);
  const ref = only?.['$ref'];
  if (typeof ref !== 'string') {
    throw new TruthLoadError(
      'an `allOf` whose sole member is not a `$ref`. See `soleAllOfRef`: the alias form is the only one implemented.',
    );
  }
  return ref;
}

const deref = (spec: Json, node: Json, seen: ReadonlySet<string>): { node: Json; seen: Set<string> } => {
  let current = node;
  const visited = new Set(seen);
  for (;;) {
    // A bare `$ref` first: where both spellings are present the direct one is
    // the node's own claim, and `allOf` beside it would be the composition case
    // that throws anyway.
    const ref = typeof current['$ref'] === 'string' ? current['$ref'] : soleAllOfRef(current);
    if (ref === null) break;
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

/**
 * Everything about a ground truth that is not the Swagger 2.0 format.
 *
 * The floors are a function rather than a table of numbers because each one
 * names what its absence would mean for *this* target — "the anonymous sweep
 * did not run" is a different sentence when the API gates 24 of 25 reads than
 * when it gates 37 of 50. A floor tight enough to trip on a legitimate refresh
 * gets raised until it never fires, which is how a floor becomes decoration.
 */
/**
 * A category this document cannot ground, and why.
 *
 * The reason travels with the category because it differs per target and per
 * category, and the grade report prints it beside the vacuous row. It used to
 * be one hard-coded sentence about foreign keys, which was true of the only
 * entry there was; Vikunja adds a second with an entirely different argument.
 */
export interface NotDerived {
  readonly category: GradeCategoryId;
  /**
   * One metric, where only part of a category is ungrounded.
   *
   * Added by 0023 because two categories need it and one of them is already
   * wrong without it. `entity-identity` precision is grounded while its recall
   * is not (§3.1), and `narrowing`'s stated reason — "declares no formats at
   * all" — grounds only its *precision*: post-`allOf`-fix the document declares
   * 7 enum claims on matched response fields, so `narrowing.recall` is
   * derivable and was reading `vacuous` when it should read a number.
   *
   * Omitted means the whole category, which is what `identifier` still is.
   */
  readonly metric?: string;
  readonly reason: string;
}

/**
 * Categories no Swagger 2.0 document can ground, whatever it describes.
 *
 * These are properties of the **format**, not of a target, so they live here
 * rather than being copied into every `TruthSource` — where the third copy would
 * be the one that drifts. A source may still add its own entries, and may
 * override one of these by naming the same category or metric.
 *
 *   - **which definitions are tables.** Swagger 2.0 has no way to say it. 0023
 *     §3.1 measured three candidate criteria against Vikunja and every one
 *     misclassified in at least one direction, so a recall metric would report
 *     the crawl's seeding as inference quality.
 *   - **scalar foreign keys.** The format declares `project_id` an integer.
 *     Nothing links it to `models.Project`, and the associations it *can*
 *     express are embedded objects and arrays, which `RelationSchema` cannot
 *     represent. 0018's vocabulary rule: exclude a claim the model cannot make.
 */
export const FORMAT_NOT_DERIVED: readonly NotDerived[] = [
  {
    category: 'entity-identity',
    metric: 'entity-identity.recall',
    reason:
      'Swagger 2.0 does not declare which of its definitions are tables, so there is no denominator for "entities a faithful mock needs" that is not a proxy for something else (0023 §3.1).',
  },
  {
    category: 'entity-relation',
    reason:
      'Swagger 2.0 declares no scalar foreign keys — an `_id` property is an integer with a prose description — and the associations it does declare are embedded objects or arrays, which `RelationSchema` cannot express (0023 §3.2).',
  },
];

export interface TruthSource {
  readonly id: string;
  readonly specFile: string;
  readonly defaultBasePath: string;
  /** Categories whose truth side this document cannot supply. */
  readonly notDerived: readonly NotDerived[];
  readonly floors: (
    counts: TruthModel['counts'],
    endpoints: readonly TruthEndpoint[],
    entities: readonly TruthEntity[],
  ) => Array<[boolean, string]>;
}

export interface Snapshot {
  readonly spec: Json;
  readonly pin: Json;
  readonly probe: Json;
  readonly specBytes: Buffer;
}

function readSnapshot(root: string, source: TruthSource): Snapshot {
  const readJson = (name: string): { json: Json; bytes: Buffer } => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(root, name));
    } catch (err) {
      // operational: a missing snapshot is an environment problem with one
      // instruction attached, not a defect to stack-trace.
      throw new TruthLoadError(
        `no ground-truth snapshot at ${join(root, name)}. Run \`node packages/verify/scripts/snapshot.mjs ${source.id} --write\` against the pinned image.`,
      );
    }
    const parsed = asObject(JSON.parse(bytes.toString('utf8')));
    if (parsed === null) throw new TruthLoadError(`${name} is not a JSON object`);
    return { json: parsed, bytes };
  };
  const spec = readJson(source.specFile);
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
 * Each target's floors come from its own `TruthSource`, measured against its
 * own snapshot.
 */
export function buildSwagger2Truth(snapshot: Snapshot, source: TruthSource): TruthModel {
  const { spec, pin, probe, specBytes } = snapshot;

  const specSha256 = createHash('sha256').update(specBytes).digest('hex');
  if (pin['specSha256'] !== specSha256) {
    throw new TruthLoadError(
      `pin.json records ${String(pin['specSha256'])} but the spec beside it hashes to ${specSha256}. One of the two was hand-edited; re-run the snapshot script.`,
    );
  }

  const basePath = typeof pin['basePath'] === 'string' ? pin['basePath'] : source.defaultBasePath;
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
        rowDefinition: rowDefinitionOf(spec, operation),
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

  const entities = deriveEntities(spec, endpoints);
  const floors = source.floors(counts, endpoints, entities);
  const broken = floors.filter(([held]) => !held).map(([, message]) => message);
  if (broken.length > 0) {
    throw new TruthLoadError(`the ground truth did not load:\n  - ${broken.join('\n  - ')}`);
  }

  return {
    image: String(pin['image'] ?? ''),
    specSha256,
    basePath,
    endpoints,
    entities,
    counts,
    // Format-level first, then the source's, which wins where both name the
    // same category or metric — a target that finds a way to ground one of
    // these overrides it rather than editing the shared list.
    notDerived: mergeNotDerived(FORMAT_NOT_DERIVED, source.notDerived),
  };
}

/**
 * The definition name a schema node resolves to, with the array step taken.
 *
 * `deref` already tracks the refs it followed for cycle detection; the *last*
 * one is the name the node resolves to. Returning it is what makes pairing
 * possible at all: without a name there is nothing to pair an entity *to*, and
 * with only the resolved node there is no way to tell two structurally
 * identical definitions apart.
 */
function rowDefinitionOf(spec: Json, operation: Json): TruthEndpoint['rowDefinition'] {
  const responses = asObject(operation['responses']);
  if (responses === null) return null;
  for (const [status, raw] of Object.entries(responses)) {
    if (!status.startsWith('2')) continue;
    const response = asObject(raw);
    if (response === null) continue;
    const { node: unwrapped } = deref(spec, response, new Set());
    const schema = asObject(unwrapped['schema']);
    if (schema === null) continue;
    const { node: root } = deref(spec, schema, new Set());
    // Two shapes and no guessing beyond them, which is `rowOf`'s rule on the
    // other side: an array of objects is a list of rows, a bare object is one
    // row. Anything else yields nothing.
    const isArray = root['type'] === 'array';
    const target = isArray ? asObject(root['items']) : schema;
    if (target === null) continue;
    const { node, seen } = deref(spec, target, new Set());
    const ref = [...seen].pop();
    if (ref === undefined) continue;
    if (node['type'] !== 'object' || asObject(node['properties']) === null) continue;
    return { name: ref.split('/').pop() ?? ref, fromList: isArray };
  }
  return null;
}

/** Depth-1 properties of one definition, in the truth's own field vocabulary. */
function definitionProperties(spec: Json, name: string): TruthField[] {
  const definitions = asObject(spec['definitions']);
  const definition = definitions === null ? null : asObject(definitions[name]);
  if (definition === null) return [];
  const { node } = deref(spec, definition, new Set());
  const properties = asObject(node['properties']);
  if (properties === null) return [];
  const required = new Set(Array.isArray(node['required']) ? (node['required'] as string[]) : []);
  const out: TruthField[] = [];
  for (const [property, raw] of Object.entries(properties)) {
    const child = asObject(raw);
    if (child === null) continue;
    const { node: resolved } = deref(spec, child, new Set());
    out.push({
      pointer: property,
      type: typeof resolved['type'] === 'string' ? (resolved['type'] as string) : 'object',
      format: typeof resolved['format'] === 'string' ? (resolved['format'] as string) : null,
      enumValues: Array.isArray(resolved['enum'])
        ? (resolved['enum'] as unknown[]).map(String)
        : null,
      required: required.has(property),
    });
  }
  return out;
}

/**
 * The entity truth side: definitions reachable as a 2xx response row.
 *
 * Reachability is over the endpoints handed in, so a caller scoring a crawl gets
 * the definitions that crawl could have seen. What this deliberately does **not**
 * do is decide which definitions are *tables* — 0023 §3.1 measured three
 * candidate criteria and every one misclassified, so `entity-identity.recall`
 * is `notDerived` rather than computed against a denominator that would report
 * the crawl's seeding as inference quality.
 */
function deriveEntities(spec: Json, endpoints: readonly TruthEndpoint[]): TruthEntity[] {
  const byName = new Map<string, { operations: string[]; fromList: boolean[] }>();
  for (const endpoint of endpoints) {
    if (endpoint.rowDefinition === null) continue;
    const { name, fromList } = endpoint.rowDefinition;
    const seen = byName.get(name) ?? { operations: [], fromList: [] };
    seen.operations.push(`${endpoint.method} ${endpoint.shape}`);
    seen.fromList.push(fromList);
    byName.set(name, seen);
  }
  return [...byName.entries()]
    .map(([name, { operations, fromList }]) => ({
      name,
      properties: definitionProperties(spec, name),
      operations,
      // empty: unreachable — a name is in this map only because an endpoint
      // pushed a `fromList` beside it. And `true` is harmless either way:
      // `fromList` is reported, never scored.
      fromList: fromList.every((f) => f),
    }))
    .filter((entity) => entity.properties.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format-level entries, overridden by any source entry naming the same key.
 *
 * Keyed on `metric ?? category`, so a source that grounds
 * `entity-identity.recall` replaces exactly that and a source that grounds the
 * whole of `entity-relation` replaces exactly that.
 */
export function mergeNotDerived(
  format: readonly NotDerived[],
  source: readonly NotDerived[],
): NotDerived[] {
  const keyOf = (n: NotDerived): string => n.metric ?? n.category;
  const merged = new Map(format.map((n) => [keyOf(n), n]));
  for (const entry of source) merged.set(keyOf(entry), entry);
  return [...merged.values()];
}

/** The truth, read from the committed snapshot. The wiring, and nothing else. */
export function loadSwagger2Truth(
  source: TruthSource,
  options: { root?: string } = {},
): TruthModel {
  return buildSwagger2Truth(readSnapshot(options.root ?? fixtureDir(source.id), source), source);
}
