/**
 * Stage 2 — `capture/` to a `SiteModel`.
 *
 * The four pieces run in the order §7's own evidence rules require:
 *
 * 1. **entity dedup** (`entities.ts`), first because it gates every frequency
 *    heuristic after it — a list endpoint polled six times is not six times the
 *    evidence, and the narrowing ladder's corroboration rung reads counts;
 * 2. **the narrowing ladder** (`narrowing.ts`), UI constraint as primary
 *    evidence, declining any narrowing the capture did not justify;
 * 3. **endpoints and auth** (`operations.ts`), where the auth verdict is copied
 *    rather than re-derived from strictly less evidence than capture had;
 * 4. **components and tokens** (`components.ts`, `tokens.ts`).
 *
 * The output is parsed by `SiteModelSchema` before it is returned. An illegal
 * model is a defect in this stage, and returning one would push the failure
 * into codegen where it reads as a codegen bug.
 *
 * **This package does not import `@siteforge/verify`** (decision 0020), and a
 * test asserts it. The grader's definitions must not reach an inference
 * strategy as code; the score is the only channel.
 */
import {
  SITE_MODEL_VERSION,
  SiteModelSchema,
  shortHash,
  type Entity,
  type SiteModel,
} from '@siteforge/schema';
import { readCapture, type Capture, type CapturedRoute } from './capture.js';
import {
  dedupeRows,
  entityNameFor,
  fieldNameOf,
  fieldType,
  keyOf,
  rowOf,
  shapeIdentity,
  soleType,
  type RowShape,
} from './entities.js';
import { narrowedField, narrowingObjection } from './narrowing.js';
import { operationOf } from './operations.js';
import { inferComponents, inferLayout } from './components.js';
import { inferTokens } from './tokens.js';

export * from './capture.js';
export * from './entities.js';
export * from './narrowing.js';
export * from './operations.js';
export * from './components.js';
export * from './tokens.js';
export * from './variant.js';

/** What the run wants to say about itself, beside the model. */
export interface InferReport {
  readonly rowsSeen: number;
  readonly entities: number;
  readonly operations: number;
  readonly components: number;
  /** Narrowings §7.5 would not allow, named. Empty on a run that parsed. */
  readonly objections: readonly string[];
  /** Entity merges the containment pass made, with the counts each rests on. */
  readonly merges: readonly string[];
}

/**
 * Which pieces run. Every one defaults on; turning one off is a measurement.
 *
 * The user's build order — dedup, then the narrowing ladder, then endpoints and
 * auth, then components and tokens — is a claim about what gates what, and a
 * claim like that is worth measuring rather than asserting. Running the same
 * capture with one piece disabled and grading both says which categories that
 * piece actually moves. It is the mutation harness's argument applied to
 * infer's own stages: a baseline that only ever scores one way proves nothing
 * about which part of it is doing the work.
 */
export interface InferOptions {
  /** Piece 1. Off: one entity per endpoint, so a row seen twice is two entities. */
  readonly dedupeEntities?: boolean;
  /**
   * Piece 1b (decision 0025). Off: exact identity only, so a list view that
   * projects an item view stays a second entity.
   *
   * Separately ablatable from `dedupeEntities` because it is a separately
   * justified claim — exact identity says two equal shapes are one thing, and
   * this says a projection is an observation of the thing it projects. Knowing
   * which of the two moves a metric is the whole reason the flags exist.
   */
  readonly mergeEntities?: boolean;
  /** Piece 2. Off: no narrowing reaches an entity field, however well evidenced. */
  readonly carryNarrowings?: boolean;
  /** Piece 4. Off: no components and no tokens. */
  readonly presentation?: boolean;
}

export interface InferResult {
  readonly model: SiteModel;
  readonly report: InferReport;
}

/**
 * Which endpoints' path parameters a field's values were observed as.
 *
 * §7.4 reads foreign keys off this, and §7.5 excludes it from being an enum:
 * matched by **value overlap**, never by name, because path normalisation
 * collapses every id segment to `:id` and a name comparison would test against
 * a constant.
 */
function pathParamValues(capture: Capture): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const endpoint of capture.endpoints.endpoints) {
    for (const param of endpoint.params.path) {
      for (const example of param.examples) {
        const seen = out.get(example) ?? new Set<string>();
        seen.add(endpoint.endpointId);
        out.set(example, seen);
      }
    }
  }
  return out;
}

/** Deterministic, and the same shape capture mints: a gap is addressable or it is prose. */
const gapIdFor = (label: string): string => `gap_${shortHash(label).slice(0, 12)}`;

function buildEntities(
  rows: readonly RowShape[],
  keyed: Map<string, string>,
  values: Map<string, Set<string>>,
  carryNarrowings: boolean,
): { entities: Entity[]; objections: string[]; merges: string[] } {
  const objections: string[] = [];
  const merges: string[] = [];
  const entities: Entity[] = [];
  for (const row of rows) {
    const name = keyed.get(shapeIdentity(row));
    if (name === undefined) continue;
    const key = keyOf(row.properties);
    if (key === null) continue;
    const fields = Object.entries(row.properties)
      .filter(([, node]) => soleType(node) !== 'array')
      .flatMap(([wire, node]) => {
        const field = fieldNameOf(wire);
        if (field === null) return [];
        if (node.narrowing !== null && node.narrowing !== undefined) {
          const objection = narrowingObjection(field, node.narrowing);
          if (objection !== null) objections.push(objection);
        }
        const built = narrowedField(
          field,
          node,
          !row.required.includes(wire),
          fieldType(node),
          [...(values.get(wire) ?? [])].sort(),
        );
        return [carryNarrowings ? built : { ...built, narrowing: null }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    if (fields.length === 0) continue;
    // §7.5's treatment, applied to an identity claim rather than a type one:
    // the counts travel with the merge, review is mandatory, and a gap is
    // minted — `MergeRecordSchema` rejects a record these do not support, so an
    // unjustified merge does not parse rather than being caught downstream.
    const evidence = row.mergedFrom ?? null;
    const mergedFrom =
      evidence === null
        ? null
        : {
            kind: 'field-set-containment' as const,
            sources: [...evidence.sources],
            narrowerFields: evidence.narrowerFields,
            widerFields: evidence.widerFields,
            sharedFields: evidence.sharedFields,
            keyField: evidence.keyField,
            reviewRequired: true as const,
            gapId: gapIdFor(`entity-merge:${[...evidence.sources].sort().join(',')}`),
          };
    if (mergedFrom !== null) {
      merges.push(
        `${name}: ${mergedFrom.narrowerFields} of ${mergedFrom.widerFields} fields contained, ` +
          `keyed on ${mergedFrom.keyField}, from ${mergedFrom.sources.join(' + ')}`,
      );
    }
    entities.push({ name, key, fields, relations: [], mergedFrom, seed: null });
  }
  return { entities, objections, merges };
}

/** One route template per captured pattern, wired to the operations it called. */
function routeTemplates(
  routes: readonly CapturedRoute[],
  layoutId: string,
  operationIds: readonly string[],
): SiteModel['routes'] {
  const byPattern = new Map<string, CapturedRoute[]>();
  for (const route of routes) {
    const seen = byPattern.get(route.meta.urlPattern) ?? [];
    seen.push(route);
    byPattern.set(route.meta.urlPattern, seen);
  }
  return [...byPattern.entries()].map(([pattern, instances]) => ({
    templateId: `tpl_${shortHash(pattern).slice(0, 12)}`,
    pathPattern: pattern,
    layoutId,
    content: {
      kind: 'element' as const,
      element: {
        tag: 'main',
        role: null,
        classes: [],
        attributes: [],
        stateVariants: [],
        entityAnchor: null,
        children: [],
      },
    },
    // Every operation the crawl saw, not a guess at which page called which:
    // the recorder tags an observation with the route it came from, but a SPA
    // prefetches across routes and attributing them would be an invention.
    dataSources: [...operationIds],
    instances: instances.map((r) => r.routeId),
    requiresAuth: instances[0]!.meta.requiresAuth === 'required',
    // The capture's `unknown` becomes `null` here, because that is how the
    // SiteModel spells it: the template's union has no `unknown` member and a
    // missing behaviour is the absence of a claim rather than a third kind of
    // one. Not collapsed to `renders-anyway`, which would be the boolean
    // mistake §5 spends a paragraph on, one level up.
    unauthenticatedBehavior:
      instances[0]!.meta.unauthenticatedBehavior.kind === 'redirect'
        ? { kind: 'redirect' as const, to: instances[0]!.meta.unauthenticatedBehavior.to }
        : instances[0]!.meta.unauthenticatedBehavior.kind === 'accessible'
          ? { kind: 'renders-anyway' as const }
          : null,
  }));
}

export function inferSiteModel(capture: Capture, options: InferOptions = {}): InferResult {
  const {
    dedupeEntities = true,
    mergeEntities = true,
    carryNarrowings = true,
    presentation = true,
  } = options;

  // --- piece 1: rows, deduplicated by entity identity before anything counts
  const rows = capture.endpoints.endpoints
    .map(rowOf)
    .filter((row): row is RowShape => row !== null);
  const deduped = dedupeEntities ? dedupeRows(rows, { merge: mergeEntities }) : rows;

  /** Identity to entity name, so an operation and its entity agree. */
  const keyed = new Map<string, string>();
  const used = new Set<string>();
  for (const row of deduped) {
    const source = capture.endpoints.endpoints.find((e) => row.sources.includes(e.endpointId));
    let name = entityNameFor(source?.pathPattern ?? '/row');
    while (used.has(name)) name = `${name}Row`;
    used.add(name);
    keyed.set(shapeIdentity(row), name);
    // Every identity folded into this row resolves to it as well. `operationOf`
    // calls `rowOf` on the raw endpoint, so without this the endpoint whose
    // projection motivated the merge would lose its `effect.entity` — a merge
    // that improves the entity list and damages the operations is not one.
    for (const absorbed of row.mergedIdentities ?? []) keyed.set(absorbed, name);
  }

  // --- piece 2: narrowings, carried only where the evidence justified them
  const { entities, objections, merges } = buildEntities(
    deduped,
    keyed,
    pathParamValues(capture),
    carryNarrowings,
  );
  const declared = new Set(entities.map((e) => e.name));

  // --- piece 3: endpoints and auth
  const entityOf = (row: RowShape): string | null => {
    const name = keyed.get(shapeIdentity(row));
    return name !== undefined && declared.has(name) ? name : null;
  };
  const operations = capture.endpoints.endpoints.map((e) => operationOf(e, entityOf));

  // --- piece 4: components and tokens
  const layout = inferLayout(capture.routes);
  const presentationRoutes = presentation ? capture.routes : [];
  const model = {
    modelVersion: SITE_MODEL_VERSION,
    artifact: 'site-model' as const,
    scrubbed: true,
    provenance: {
      recordedAt: new Date(0).toISOString(),
      runId: `run_${shortHash(`infer:${capture.manifest.siteId}`)}`,
    },
    siteId: capture.manifest.siteId,
    sourceCapture: {
      siteId: capture.manifest.siteId,
      contentHash: capture.manifest.contentHash,
    },
    tokens: inferTokens(presentationRoutes),
    fonts: [],
    assets: [],
    components: inferComponents(presentationRoutes),
    layouts: [layout],
    routes: routeTemplates(capture.routes, layout.layoutId, operations.map((o) => o.operationId)),
    entities,
    operations,
    behaviours: [],
  };

  return {
    model: SiteModelSchema.parse(model),
    report: {
      rowsSeen: rows.length,
      entities: entities.length,
      operations: operations.length,
      components: model.components.length,
      objections,
      merges,
    },
  };
}

/** The stage, from a capture directory. §4: files on disk, nothing in memory. */
export function inferFromCapture(root: string, options: InferOptions = {}): InferResult {
  return inferSiteModel(readCapture(root), options);
}
