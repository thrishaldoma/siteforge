/**
 * Piece 2 — the narrowing ladder, UI constraint first.
 *
 * §7.5 ranks the evidence and this file is that ranking, applied to entity
 * fields. The default is `string`; narrowing must be justified and widening is
 * free, because §5 turns the response schema into the mock backend's data
 * model — a wrong enum makes the clone reject values the real API accepts, on
 * every trajectory that touches the field, silently.
 *
 * **The counts come from deduplicated records** (piece 1). That is the whole
 * reason the order is what it is: run the corroboration rung over observations
 * and a list endpoint polled six times makes every field look closed.
 *
 * Capture already narrowed the *response schemas* — `classifyStringField` runs
 * there, over the bodies it saw. This is the entity-level pass: it carries the
 * narrowing that capture justified onto the entity field, and it declines to
 * invent one capture did not. A narrowing that appears here and nowhere in the
 * capture would be a claim with no observation behind it.
 */
import type { EntityField, JsonSchemaNode, NarrowingRecord } from '@siteforge/schema';
import { soleType } from './entities.js';

/** What a field's narrowing rests on, if anything. */
export interface FieldNarrowing {
  readonly narrowing: NarrowingRecord | null;
  readonly enumValues: readonly string[] | null;
}

/**
 * Carry capture's narrowing onto the entity field, or decline.
 *
 * Three ways to decline, and each is the honest answer rather than a fallback:
 * the node carries no narrowing record, so nothing justified one; the node is
 * not a string, so there is no domain to close; or the record is a format,
 * which annotates a shape without closing a domain and belongs on the schema
 * node rather than on the entity field.
 */
export function narrowingFor(node: JsonSchemaNode): FieldNarrowing {
  const record = node.narrowing ?? null;
  if (record === null) return { narrowing: null, enumValues: null };
  if (record.kind !== 'enum') return { narrowing: record, enumValues: null };
  const values = node.enum ?? null;
  if (values === null || values.length === 0) {
    // A record saying "enum" with no values is not a narrowing, it is a
    // half-written one. `[].every(…)` would have called it satisfied.
    return { narrowing: null, enumValues: null };
  }
  return { narrowing: record, enumValues: values.map((v) => String(v)) };
}

/**
 * Is this narrowing one §7.5 would allow?
 *
 * The invariant, restated where the model is assembled rather than trusted from
 * upstream: **no enum from fewer than 20 distinct records without a UI
 * constraint backing it.** The schema enforces it too, so a violation would
 * fail to parse — this returns the reason instead, so the run can say which
 * field and why rather than surfacing a Zod path.
 */
export function narrowingObjection(field: string, record: NarrowingRecord): string | null {
  if (record.kind !== 'enum') return null;
  if (record.uiConstraint !== null && record.uiConstraint !== undefined) return null;
  if (record.distinctRecords >= 20) return null;
  return `\`${field}\` is an enum drawn from ${record.distinctRecords} distinct record(s) with no UI constraint behind it. §7.5: low cardinality is not evidence of a closed domain, and a thin sample is the commonest way to get one.`;
}

/** The entity field, with whatever the evidence supports and nothing more. */
export function narrowedField(
  name: string,
  node: JsonSchemaNode,
  optional: boolean,
  type: EntityField['type'],
  pathParamOf: readonly string[],
): EntityField {
  const { narrowing } = narrowingFor(node);
  return {
    name,
    type,
    optional,
    // §8's determinism harness reads this: an id from a seeded counter, never
    // `crypto.randomUUID()`. Only claimed where the shape says so.
    generatedBy: name === 'id' && soleType(node) === 'integer' ? 'counter' : 'none',
    narrowing: narrowing?.kind === 'enum' ? narrowing : null,
    pathParamOf: [...pathParamOf],
  };
}
