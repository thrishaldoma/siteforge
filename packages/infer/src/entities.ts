/**
 * Piece 1 — the data model, deduplicated by entity identity first.
 *
 * §13: *deduplicate by entity identity before any frequency heuristic.* A list
 * endpoint polled six times is not six times the evidence, and this stage is
 * where that either happens once or is forgotten in four places — every count
 * below is drawn from `records`, never from observations.
 *
 * It is first because it gates everything after it. The narrowing ladder's
 * corroboration rung is "distinct values stayed flat while distinct records
 * grew"; run it over observations instead of records and a polled list makes
 * every field look like an enum. The enum finding is what put this in front.
 *
 * **Rows come from the response schemas capture already inferred**, not from
 * the bodies: capture walked every observation and produced one schema per
 * status, which is the deduplicated shape. What is deduplicated here is the
 * *entity* — the same row shape reached through `GET /projects` and
 * `GET /projects/:id` is one entity, and counting it twice would double every
 * denominator downstream.
 */
import type { EndpointDescriptor, EntityField, JsonSchemaNode } from '@siteforge/schema';
import { MERGE_MIN_SHARED_FIELDS } from '@siteforge/schema';
import { IDENTITY_KEYS } from '@siteforge/shared';

/** A row shape found in a response, with where it was found. */
export interface RowShape {
  /** The endpoints whose responses carry it, in observation order. */
  readonly sources: readonly string[];
  /** JSON pointer into the response schema where the row sits. */
  readonly rowsAt: string;
  readonly properties: Readonly<Record<string, JsonSchemaNode>>;
  readonly required: readonly string[];
  /** True when the row was an element of an array — a list rather than an item. */
  readonly fromList: boolean;
  /**
   * Set when narrower rows were folded into this one by the containment pass
   * (decision 0025). Carries the counts the merge was justified on, and nothing
   * about the route or the declared definitions — reading either would be
   * fitting to the metric this rule was written to move.
   */
  readonly mergedFrom?: MergeEvidence | null;
  /**
   * The `shapeIdentity` of every row folded in, so an operation returning the
   * *narrower* shape still resolves to the surviving entity.
   *
   * Without it a merge would make things worse rather than better:
   * `operationOf` calls `rowOf` on the raw endpoint and looks the result up by
   * identity, so an absorbed identity missing from the map turns a paired
   * operation into `effect.entity: null` — the model would stop claiming an
   * entity for the endpoint that motivated the merge.
   */
  readonly mergedIdentities?: readonly string[];
}

/** The counts a merge was drawn from. `MergeRecordSchema` is checked against these. */
export interface MergeEvidence {
  readonly sources: readonly string[];
  readonly narrowerFields: number;
  readonly widerFields: number;
  readonly sharedFields: number;
  readonly keyField: string;
}

/**
 * The one type a node claims, when it claims several.
 *
 * `type` is a union in JSON Schema, and a nullable field is written
 * `['string', 'null']`. The null member is a nullability statement rather than
 * a type, so it is dropped; what is left is the type the field actually is.
 */
export function soleType(node: JsonSchemaNode | undefined): string | undefined {
  const claimed = node?.type;
  if (claimed === undefined) return undefined;
  if (!Array.isArray(claimed)) return claimed;
  return claimed.filter((t) => t !== 'null')[0];
}

const isObject = (node: JsonSchemaNode | undefined): boolean =>
  soleType(node) === 'object' && node?.properties !== undefined;

/**
 * The row an endpoint's 2xx response carries, if it carries one.
 *
 * Two shapes and no guessing beyond them: an array of objects is a list of
 * rows, and a bare object is one row. Anything else — a scalar, an array of
 * scalars, an envelope this does not recognise — yields nothing, which is §7's
 * standing rule: when confidence is low, a gap rather than an invention.
 */
export function rowOf(endpoint: EndpointDescriptor): RowShape | null {
  const ok = endpoint.responses.find((r) => r.status >= 200 && r.status < 300);
  const schema = ok?.schema;
  if (!schema) return null;
  if (soleType(schema) === 'array' && isObject(schema.items)) {
    const items = schema.items!;
    return {
      sources: [endpoint.endpointId],
      rowsAt: '',
      properties: items.properties ?? {},
      required: items.required ?? [],
      fromList: true,
    };
  }
  if (isObject(schema)) {
    return {
      sources: [endpoint.endpointId],
      rowsAt: '',
      properties: schema.properties ?? {},
      required: schema.required ?? [],
      fromList: false,
    };
  }
  return null;
}

/**
 * The identity of a row shape: its scalar field names, sorted.
 *
 * Not its content and not its endpoint — two endpoints returning the same
 * fields are one entity, which is what stops a list and its item view being
 * counted twice when they carry the same shape.
 *
 * Scalars only, deliberately: nested objects are a different entity's business,
 * and including them would let `owner` being present in one response and absent
 * in another split one entity in two.
 *
 * **Exact, and deliberately so — this is not where projections are handled.** A
 * list view returning four of an item view's fourteen fields gets its own
 * identity here, and `mergeContainedRows` below is what folds it back in, under
 * conditions it has to satisfy and record. Keeping the two passes apart is the
 * point: identity stays a statement about equal shapes, and every merge beyond
 * that carries the counts that justified it.
 *
 * §7.5's asymmetry is what orders them. An over-merge makes valid states of the
 * real system unrepresentable; an under-merge only makes the model longer.
 * Splitting is free; merging must be justified — so the free direction is the
 * default and the justified one is a second pass with evidence attached.
 */
export const shapeIdentity = (row: RowShape): string =>
  Object.entries(row.properties)
    .filter(([, node]) => soleType(node) !== 'object' && soleType(node) !== 'array')
    .map(([name]) => name)
    .sort()
    .join(',');

/** Rows that are the same entity, merged, with their sources kept. */
export function dedupeRows(
  rows: readonly RowShape[],
  { merge = true }: { merge?: boolean } = {},
): RowShape[] {
  const byIdentity = new Map<string, RowShape>();
  for (const row of rows) {
    const key = shapeIdentity(row);
    if (key === '') continue;
    const seen = byIdentity.get(key);
    if (seen === undefined) {
      byIdentity.set(key, row);
      continue;
    }
    // The fuller shape wins its properties; both endpoints keep their claim on
    // the entity. A list and an item view of one row disagree about depth, not
    // about identity.
    const fuller =
      Object.keys(row.properties).length > Object.keys(seen.properties).length ? row : seen;
    byIdentity.set(key, {
      ...fuller,
      sources: [...new Set([...seen.sources, ...row.sources])],
      // Required is the intersection: a field absent from one observation of
      // the row is not required, however consistently the other showed it.
      required: seen.required.filter((f) => row.required.includes(f)),
    });
  }
  const exact = [...byIdentity.values()];
  return merge ? mergeContainedRows(exact) : exact;
}

/** The scalar field names `shapeIdentity` is built from, as a set. */
const scalarFields = (row: RowShape): Set<string> => new Set(shapeIdentity(row).split(','));

/**
 * Fold a projection into the row it is a projection of (decision 0025 §2).
 *
 * Runs after exact identity, over what that pass left. Four conditions, and
 * they are declared in 0025 rather than derived from what made the score move:
 *
 *  1. **Containment, not similarity.** A list view drops fields and never adds
 *     one, so the relation between the two observations is subset. Jaccard
 *     scores four-of-fourteen at 0.29 and so punishes the projection for being
 *     a projection, which is the case this exists to catch.
 *  2. **The same key.** A projection keeps the key it is addressed by.
 *  3. **Exactly one container**, and this is the condition carrying the weight.
 *     Containment alone over-merges at any floor — `{id, title, description,
 *     created, updated}` is a subset of almost any wide row — and what defeats
 *     that is not improbability but ambiguity: a metadata-shaped row is
 *     contained in *several* wider rows and therefore merges into none. A row
 *     that could be a projection of two entities is evidence about neither.
 *     Chains fall out of the same test (`A ⊂ B ⊂ C` gives A two containers), so
 *     no separate rule is needed and none is written.
 *  4. **`MERGE_MIN_SHARED_FIELDS`**, which only excludes the degenerate case.
 *
 * Splitting is still the free direction (§7.5): every condition above is a
 * reason *not* to merge, and the pass makes no claim it cannot show the counts
 * for.
 */
function mergeContainedRows(rows: readonly RowShape[]): RowShape[] {
  const fields = new Map(rows.map((r) => [r, scalarFields(r)] as const));
  const keyOfRow = new Map(rows.map((r) => [r, keyOf(r.properties)?.field ?? null] as const));

  /** Rows that strictly contain this one and agree with it about the key. */
  const containersOf = (row: RowShape): RowShape[] => {
    const mine = fields.get(row)!;
    const key = keyOfRow.get(row);
    if (key === null || mine.size < MERGE_MIN_SHARED_FIELDS) return [];
    return rows.filter((other) => {
      if (other === row || keyOfRow.get(other) !== key) return false;
      const theirs = fields.get(other)!;
      if (theirs.size <= mine.size) return false;
      // empty: `mine` holds at least MERGE_MIN_SHARED_FIELDS names — the guard
      // above returned for anything thinner, so the vacuous-subset case where
      // every() would admit an empty row into any container cannot arrive here.
      return [...mine].every((f) => theirs.has(f));
    });
  };

  const absorbedBy = new Map<RowShape, RowShape[]>();
  const absorbed = new Set<RowShape>();
  for (const row of rows) {
    const containers = containersOf(row);
    // Ambiguous in either direction is a merge that does not happen. Zero
    // containers is the ordinary case; two or more is the coincidence the
    // uniqueness condition exists to reject.
    if (containers.length !== 1) continue;
    const into = containers[0]!;
    absorbed.add(row);
    absorbedBy.set(into, [...(absorbedBy.get(into) ?? []), row]);
  }

  return rows
    .filter((row) => !absorbed.has(row))
    .map((row) => {
      const taken = absorbedBy.get(row);
      if (taken === undefined) return row;
      const mine = fields.get(row)!;
      return {
        ...row,
        // The container's endpoints first, so `entityNameFor` names the entity
        // after the item view rather than after whichever projection sorted
        // first. `/tasks/:task` is a better name than `/tasks/all`.
        sources: [...new Set([...row.sources, ...taken.flatMap((t) => t.sources)])],
        // A field the projection did not carry is not required, on the same
        // argument the exact pass uses one level up.
        // empty: `taken` is non-empty by construction — `absorbedBy` only ever
        // gets a key when a row was absorbed into it, so an empty list would
        // mean this row is not a merge target and the branch above returned.
        required: row.required.filter((f) => taken.every((t) => t.required.includes(f))),
        mergedIdentities: taken.map(shapeIdentity),
        mergedFrom: {
          sources: [...new Set([...row.sources, ...taken.flatMap((t) => t.sources)])],
          // The weakest link, where several projections folded into one row:
          // the schema's floor should be checked against the thinnest evidence
          // rather than against a flattering summary of it.
          narrowerFields: Math.min(...taken.map((t) => fields.get(t)!.size)),
          widerFields: mine.size,
          sharedFields: Math.min(...taken.map((t) => fields.get(t)!.size)),
          keyField: keyOfRow.get(row)!,
        },
      };
    });
}

/**
 * A name for the entity, from the endpoint that carries it.
 *
 * §7.2's rule for components, applied to rows: name it from what it is, never
 * `Entity3`. The last literal segment of the path is the resource, singularised
 * crudely — the clone's readability is what this buys, and a wrong singular is
 * visible in one glance where a numbered name is never questioned.
 */
export function entityNameFor(pathPattern: string): string {
  const segments = pathPattern.split('/').filter((s) => s.length > 0 && !s.startsWith(':'));
  const last = segments[segments.length - 1] ?? 'row';
  const singular = last.endsWith('ies')
    ? `${last.slice(0, -3)}y`
    : last.endsWith('ses')
      ? last.slice(0, -2)
      : last.endsWith('s')
        ? last.slice(0, -1)
        : last;
  return singular
    .split(/[-_]/)
    .filter((p) => p.length > 0)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join('');
}

const FIELD_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'json']);

export const fieldType = (node: JsonSchemaNode): EntityField['type'] => {
  const t = soleType(node);
  if (t === 'object' || t === 'array') return 'json';
  // The default is `string`, and §7.5 is why: it admits every value the real
  // API can produce, so widening is free and narrowing must be justified.
  return (t !== undefined && FIELD_TYPES.has(t) ? t : 'string') as EntityField['type'];
};

/**
 * Which field keys the row.
 *
 * A surrogate key is one the store generates — §10's entity anchors must not be
 * keyed on a value that changes between seeds, and the schema enforces it. An
 * integer `id` is a counter; a slug or a code is the business key an agent can
 * actually name.
 */
export function keyOf(properties: Readonly<Record<string, JsonSchemaNode>>): {
  field: string;
  kind: 'surrogate' | 'business';
} | null {
  for (const candidate of IDENTITY_KEYS) {
    const node = properties[candidate];
    if (node === undefined) continue;
    const generated = candidate === 'id' || candidate === '_id' || soleType(node) === 'integer';
    return { field: candidate, kind: generated ? 'surrogate' : 'business' };
  }
  return null;
}

/**
 * The wire name, as the model spells it.
 *
 * `FieldNameSchema` is camelCase, and Vikunja's API is snake_case — so
 * `hex_color` on the wire is `hexColor` in the store. The two are kept apart on
 * purpose rather than reconciled: a `FieldMapping` carries the JSON pointer
 * *and* the field name, so the pointer keeps the wire spelling and codegen can
 * still read the response it was given. Renaming the pointer instead would make
 * the clone fetch a field the real API does not have.
 *
 * A leading digit or an empty result yields null: better no field than one
 * named after nothing.
 */
export function fieldNameOf(wireName: string): string | null {
  const parts = wireName.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const head = parts[0]!;
  const camel =
    head[0]!.toLowerCase() +
    head.slice(1) +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join('');
  return /^[a-z][A-Za-z0-9]*$/.test(camel) ? camel : null;
}
