/**
 * The type-narrowing rules from §7.5, in one place.
 *
 * These live in `shared` rather than in `capture` on purpose. §5 puts response
 * schemas in the capture tree, so capture is where inference runs today — but
 * §7.4 derives the data model from those same schemas, and when `infer` exists
 * it will want exactly this logic. Two implementations of "is this field an
 * enum" would drift and then disagree about the same field, which is §13's
 * schema-drift failure wearing a different hat.
 *
 * The thresholds are imported from `@siteforge/schema` rather than redeclared:
 * the zod refinement on `NarrowingRecord` enforces them, and a second copy here
 * that drifted would let capture emit narrowings the schema then rejects — or
 * worse, accept ones it should not.
 */
import {
  ENUM_MAX_VALUE_RATIO,
  ENUM_MIN_DISTINCT_RECORDS,
  type IdentifierRecord,
  type NarrowingRecord,
  type UiConstraint,
} from '@siteforge/schema';

/** Keys that identify a record, so repeated observations of it collapse to one. */
export const IDENTITY_KEYS = ['id', '_id', 'uuid', 'guid', 'slug', 'key', 'sku', 'code'] as const;

/** A value that could belong to a closed domain: slug-like, no whitespace, short. */
export const ENUM_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

/** At or above this share of distinct values per record, the field is a key or free text. */
export const UNIQUENESS_EXCLUDES_ENUM = 0.9;

const IDENTIFIER_NAME = /^(?:id|uuid|guid|slug|key|token|ref|href|url|.*Id|.*_id)$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const identityOf = (obj: Record<string, unknown>): string | null => {
  for (const k of IDENTITY_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' || typeof v === 'number') return `${k}:${v}`;
  }
  return null;
};

/**
 * Collapse repeated observations of the same record.
 *
 * **Every frequency heuristic counts what this returns, never the raw
 * observation list.** A list endpoint polled six times is not six times the
 * evidence — and reading it as such is what produced
 * `title: enum [4 literal todo titles]` from 23 observations of 4 records.
 *
 * By identity where a record has one, by deep value otherwise: two identical
 * responses are one piece of evidence either way.
 */
export function dedupeByIdentity(values: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const v of values) {
    if (!isRecord(v)) {
      out.push(v);
      continue;
    }
    const key = identityOf(v) ?? `~${JSON.stringify(v)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export interface ClassifyInput {
  /** The field's name, where it has one. */
  key: string | undefined;
  /** Distinct observed values, already deduplicated. */
  distinct: readonly string[];
  /** Distinct **records** behind those values — the output of `dedupeByIdentity`. */
  recordCount: number;
  /** Field name (lowercased) → the control that constrains it. */
  uiConstraints?: ReadonlyMap<string, UiConstraint> | undefined;
  /** Observed path-parameter value → the endpoints that took it. */
  pathParamValues?: ReadonlyMap<string, ReadonlySet<string>> | undefined;
  /** Mints the review-required gap every narrowing must carry (§7). */
  mintGap: (info: { field: string | undefined; basis: string; values: readonly string[] }) => string;
}

export interface Classification {
  /** The enum members, or null. Sourced from the control when one backs it. */
  enumValues: string[] | null;
  narrowing: NarrowingRecord | null;
  identifier: IdentifierRecord | null;
}

/**
 * Decide what a string field is, and record why.
 *
 * The ranking is §7.5's: UI constraint, then corroborated cardinality, then
 * nothing. Hard exclusions are checked first and neither kind of evidence
 * overrides them. The default is `string` — narrowing must be justified, and
 * widening is free.
 */
export function classifyStringField({
  key,
  distinct,
  recordCount,
  uiConstraints,
  pathParamValues,
  mintGap,
}: ClassifyInput): Classification {
  const none: Classification = { enumValues: null, narrowing: null, identifier: null };
  const ratio = recordCount > 0 ? distinct.length / recordCount : 1;

  // ---- hard exclusion: these values are somebody's path parameter.
  //
  // Matched by VALUE, not by name. Path normalization collapses every id segment
  // to the literal `:id`, so a name comparison would test against a constant.
  // Overlap also catches `listId` pointing at `/api/lists/:id`, which no name
  // rule would — and that is exactly the foreign key §7.4 needs.
  if (pathParamValues) {
    const overlap = distinct.filter((v) => pathParamValues.has(v));
    if (overlap.length > 0) {
      const pathParamOf = [
        ...new Set(overlap.flatMap((v) => [...(pathParamValues.get(v) ?? [])])),
      ].sort();
      return { ...none, identifier: { pathParamOf, evidence: ['path-param-value-overlap'] } };
    }
  }

  // ---- hard exclusion: near-unique per record. Free text or an identifier.
  if (recordCount > 1 && ratio >= UNIQUENESS_EXCLUDES_ENUM) {
    if (key !== undefined && IDENTIFIER_NAME.test(key)) {
      return { ...none, identifier: { pathParamOf: [], evidence: ['identifier-name', 'unique-per-record'] } };
    }
    return none;
  }

  // ---- hard exclusion: sentence-like values are never a domain.
  if (!distinct.every((v) => ENUM_TOKEN.test(v))) return none;

  // ---- primary evidence: the UI constrains the field.
  //
  // Ground truth, and the only kind that is. A <select> with four options means
  // the API cannot receive a fifth, however thin the sampling was. A field is an
  // enum because the DOM constrains it, not because we did not look at enough
  // rows — and we captured the UI that drives this API.
  const constraint = key === undefined ? undefined : uiConstraints?.get(key.toLowerCase());
  if (constraint && distinct.every((v) => constraint.optionValues.includes(v))) {
    return {
      enumValues: [...constraint.optionValues],
      narrowing: {
        kind: 'enum',
        distinctRecords: recordCount,
        distinctValues: distinct.length,
        uiConstraint: constraint,
        reviewRequired: true,
        gapId: mintGap({ field: key, basis: 'ui-constraint', values: constraint.optionValues }),
      },
      identifier: null,
    };
  }

  // ---- corroboration: cardinality stayed flat while records accumulated.
  //
  // Read statically, because one capture yields a final count rather than a
  // trajectory — which is what the floor and the ratio encode.
  if (
    distinct.length >= 2 &&
    recordCount >= ENUM_MIN_DISTINCT_RECORDS &&
    distinct.length <= recordCount * ENUM_MAX_VALUE_RATIO
  ) {
    return {
      enumValues: [...distinct],
      narrowing: {
        kind: 'enum',
        distinctRecords: recordCount,
        distinctValues: distinct.length,
        uiConstraint: null,
        reviewRequired: true,
        gapId: mintGap({ field: key, basis: 'corroborated-cardinality', values: distinct }),
      },
      identifier: null,
    };
  }

  return none;
}
