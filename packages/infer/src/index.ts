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
import { bindSkippedControls } from './binding.js';
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
  /**
   * §7.6's tally, or why it did not run.
   *
   * Three states, and they must not collapse into one (0019): the ranking ran;
   * the capture carried no `flows/` at all, so there was no input; or the piece
   * was ablated. The first draft reported the ablation as "no flows/ in this
   * capture", which is a false statement about the artifact — and the exact
   * shape of conflation this field exists to prevent.
   */
  readonly binding: BindingTally | BindingNotRun;
}

export interface BindingNotRun {
  readonly ran: false;
  readonly reason: 'no-flows-in-capture' | 'disabled';
}

/**
 * What §7.6's ranking did, per rung. 0041 §5 predicts every one of these.
 *
 * **Every number here is a draw, not a figure.** §7.6's input is
 * `flows/skipped-controls.json`, which the probe pass writes, and that pass is
 * non-deterministic in a way that reaches this file: the control count read 84,
 * 83 and 79 across three completed crawls of one pinned digest (0043 §1.2), so
 * `considered` — and everything computed from it, including
 * `synthesized-endpoint`'s denominator — takes a new value nearly every run.
 *
 * So the tally carries the capture it was drawn from. §13 fixed the same
 * problem for the skipped-control count by refusing to quote a figure in the
 * manual and letting the count live in the run report *beside the run that
 * produced it*; this is that discipline applied one stage down, where the
 * numbers are one transcription further from the crawl and correspondingly
 * easier to mistake for properties of the model.
 */
export interface BindingTally {
  readonly ran: true;
  /**
   * The crawl these numbers are a draw from.
   *
   * Not decoration: a binding count with no crawl attached is a point estimate
   * of a variable, and the reader has no way to know that from the number.
   */
  readonly drawnFrom: string;
  readonly considered: number;
  readonly bound: number;
  readonly declined: number;
  readonly unbound: number;
  /** Distinct operations after dedup by (method, pattern). */
  readonly operations: number;
  readonly byRank: Readonly<Record<string, number>>;
  readonly declinedByRung: Readonly<Record<string, number>>;
  readonly silentRungs: readonly string[];
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
  /** Piece 5 (§7.6). Off: no skipped control is bound, and every gap stands alone. */
  readonly bindControls?: boolean;
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

/**
 * Does the observation agree with the inference? (decision 0027)
 *
 * The merge rule reads **shapes**: one row's field set contained in another's.
 * `observedKeyValues` is the other kind of evidence — two endpoints whose rows
 * carry the same key values returned the same *records*, which is a fact rather
 * than a similarity. This says whether the two agree.
 *
 * **It is a report and not a gate**, and that is the whole design. An empty
 * intersection has two meanings the capture cannot tell apart — the merge is
 * wrong, or the crawl saw disjoint pages of one collection — so §7's standing
 * rule applies: record the fact, not the verdict. Wiring it into the merge would
 * fail a correct merge whenever pagination happened to fall the wrong way.
 */
function auditMerge(
  sources: readonly string[],
  keyValues: Map<string, { field: string; values: readonly string[] }>,
): string {
  const seen = sources.map((id) => keyValues.get(id)).filter((k) => k !== undefined);
  if (seen.length < 2) return 'key-value overlap not checkable: fewer than two sources recorded key values';
  const fields = new Set(seen.map((k) => k!.field));
  if (fields.size > 1) return `key fields disagree (${[...fields].join(', ')}), so no overlap is meaningful`;
  const sets = seen.map((k) => new Set(k!.values));
  const first = sets[0]!;
  // empty: `sets` holds at least two members — the guard above returned for
  // fewer — so there is no case where every() admits a value nothing contains.
  const shared = [...first].filter((v) => sets.every((set) => set.has(v)));
  const smallest = Math.min(...sets.map((set) => set.size));
  // Reported as a fraction of the *smallest* side: a five-row item view fully
  // contained in a two-hundred-row list is complete agreement, and scoring it
  // against the union would read as 2.5%.
  return shared.length === 0
    ? `key values do NOT overlap (${sets.map((x) => x.size).join(' vs ')} distinct) — the containment may be coincidence, or the crawl saw disjoint pages`
    : `${shared.length} of ${smallest} key values shared — the same records, observed twice`;
}

function buildEntities(
  rows: readonly RowShape[],
  keyed: Map<string, string>,
  values: Map<string, Set<string>>,
  carryNarrowings: boolean,
  keyValues: Map<string, { field: string; values: readonly string[] }>,
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
          `keyed on ${mergedFrom.keyField}, from ${mergedFrom.sources.join(' + ')}` +
          ` — ${auditMerge(mergedFrom.sources, keyValues)}`,
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
    bindControls = true,
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
    new Map(
      capture.endpoints.endpoints
        .filter((e) => e.observedKeyValues !== null)
        .map((e) => [e.endpointId, e.observedKeyValues!]),
    ),
  );
  const declared = new Set(entities.map((e) => e.name));

  // --- piece 3: endpoints and auth
  const entityOf = (row: RowShape): string | null => {
    const name = keyed.get(shapeIdentity(row));
    return name !== undefined && declared.has(name) ? name : null;
  };
  const observedOperations = capture.endpoints.endpoints.map((e) => operationOf(e, entityOf));

  // --- piece 5: §7.6, controls capture never fired
  //
  // Appended after the observed ones so an observation always wins the dedup
  // inside `bindSkippedControls`: a weaker claim must not displace a stronger
  // one about the same (method, pattern).
  const bound =
    bindControls && capture.skippedControls !== null
      ? bindSkippedControls(capture, capture.skippedControls)
      : null;
  const operations = [...observedOperations, ...(bound?.operations ?? [])];

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
      binding:
        bound === null
          ? { ran: false as const, reason: bindControls ? ('no-flows-in-capture' as const) : ('disabled' as const) }
          : {
              ran: true as const,
              drawnFrom: capture.manifest.provenance.runId,
              considered: bound.report.considered,
              bound: bound.report.bound.length,
              declined: bound.report.declined.length,
              unbound: bound.report.unbound.length,
              operations: bound.operations.length,
              byRank: bound.report.bound.reduce<Record<string, number>>((acc, b) => {
                const rung = b.evidence.find((e) => e.rank === b.rank)?.rung ?? '?';
                acc[rung] = (acc[rung] ?? 0) + 1;
                return acc;
              }, {}),
              declinedByRung: bound.report.declined.reduce<Record<string, number>>((acc, d) => {
                acc[d.rung] = (acc[d.rung] ?? 0) + 1;
                return acc;
              }, {}),
              // A rung nobody can prove fires. Reported rather than silent —
              // §13, and 0041 §5 predicts exactly which ones these are.
              silentRungs: bound.report.silentRungs,
            },
    },
  };
}

/** The stage, from a capture directory. §4: files on disk, nothing in memory. */
export function inferFromCapture(root: string, options: InferOptions = {}): InferResult {
  return inferSiteModel(readCapture(root), options);
}
