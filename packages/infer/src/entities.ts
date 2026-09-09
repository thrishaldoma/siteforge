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
 * **Exact, and it is the conservative direction.** A list view that returns
 * four of an item view's fourteen fields gets its own identity, so Vikunja's
 * eleven rows became four entities where a human would have said three. Merging
 * on subset would fix that and would also fuse two genuinely different rows
 * that happen to share their scalars — and the two errors are not
 * interchangeable. §7.5's argument one level up: an over-merge makes valid
 * states of the real system unrepresentable, an under-merge only makes the
 * model longer. Splitting is free; merging must be justified.
 */
export const shapeIdentity = (row: RowShape): string =>
  Object.entries(row.properties)
    .filter(([, node]) => soleType(node) !== 'object' && soleType(node) !== 'array')
    .map(([name]) => name)
    .sort()
    .join(',');

/** Rows that are the same entity, merged, with their sources kept. */
export function dedupeRows(rows: readonly RowShape[]): RowShape[] {
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
  return [...byIdentity.values()];
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
