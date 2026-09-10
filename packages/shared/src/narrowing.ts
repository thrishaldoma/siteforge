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

/**
 * Slug-like: the rank-5 shape signal, and **only** a positive one.
 *
 * This regex spent the project as an unranked veto above the whole ladder,
 * where it rejected 161 of 273 observed string fields before any evidence was
 * consulted — including every numeric-coded domain, since it requires a leading
 * letter. §7.5 ranks value shape *last* among the reasons to believe a field is
 * an enum, and its negation was the first reason to disbelieve it: the same
 * property at rank 5 arguing for and rank 0 arguing against.
 *
 * Now it does one job. It supports the weakest positive branch and refutes
 * nothing, which is what a rank-5 signal is allowed to do.
 */
export const ENUM_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

/**
 * Prose: the rank-4 exclusion, testing what §7.5 actually names.
 *
 * "Values containing sentence-like text" is a claim about prose — whitespace,
 * sentence punctuation, length. `ENUM_TOKEN`'s negation was standing in for it
 * and is far wider: `"0"`, `"v0.24.6"` and `"en-US"` are not sentences by any
 * reading, and all three failed it. §13's stand-in family, one more time.
 *
 * Deliberately narrow. A value this rejects cannot be a domain member whatever
 * else is true of it — except under rank 2, where a control that offers the
 * value has said the API can receive it, and a control outranks a guess about
 * spelling.
 */
export const SENTENCE_LIKE = /\s|[.!?;]\s|^.{64,}$/;

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
 * **One ranking, and nothing sits above it (§7.5).** Evidence that refutes an
 * enum is ranked alongside evidence that supports one, in the same list, and the
 * first entry that fires decides:
 *
 *   1. path-parameter value overlap  → identifier
 *   2. UI constraint                 → enum
 *   3. near-unique per record        → not an enum
 *   4. prose                         → not an enum
 *   5. corroborated cardinality + slug shape → enum
 *
 * There used to be a tier above all of it — three "hard exclusions, regardless
 * of the above" — and that tier is how `ENUM_TOKEN`'s negation came to veto the
 * ladder's own primary evidence for the life of the project. A `<select>`
 * offering `<option value="0">` is ground truth that the API receives `"0"`, and
 * it was rejected before rank 2 was reached because `"0"` does not start with a
 * letter. Nobody reviewing the ranking could see it: **a filter above the
 * ranking is invisible to every review of the ranking.**
 *
 * So the rule is structural rather than a fix to one regex: a condition that can
 * veto a ranked branch is itself a ranked entry, and if it cannot be argued a
 * rank it cannot be applied. Each entry below states its rank and why it sits
 * where it does.
 *
 * The default is `string` — narrowing must be justified, and widening is free.
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
  // Nothing observed narrows nothing, and this is not rank 0 sneaking back in:
  // it is the ladder's precondition rather than a branch of it. Every entry
  // below reasons about observed values, so with none there is no evidence for
  // any of them to weigh — `distinct.every(…)` would return true twice over and
  // hand back a fully-justified enum for a field nothing was ever seen for.
  if (distinct.length === 0) return none;
  const ratio = recordCount > 0 ? distinct.length / recordCount : 1;

  // ---- rank 1: these values are somebody's path parameter → identifier.
  //
  // Ground truth like rank 2, about a prior question: is this a key. Above the
  // UI constraint because a key a control also happens to offer is still a key,
  // and §7.4 reads foreign keys from exactly this.
  //
  // Matched by VALUE, not by name. Path normalization collapses every id segment
  // to the literal `:id`, so a name comparison would test against a constant.
  // Overlap also catches `listId` pointing at `/api/lists/:id`, which no name
  // rule would.
  if (pathParamValues) {
    const overlap = distinct.filter((v) => pathParamValues.has(v));
    if (overlap.length > 0) {
      const pathParamOf = [
        ...new Set(overlap.flatMap((v) => [...(pathParamValues.get(v) ?? [])])),
      ].sort();
      return { ...none, identifier: { pathParamOf, evidence: ['path-param-value-overlap'] } };
    }
  }

  // ---- rank 2: the UI constrains the field → enum.
  //
  // §7.5's primary, and the only evidence that is ground truth: a <select> with
  // four options means the API cannot receive a fifth, however thin the sampling
  // was. **Above ranks 3, 4 and 5**, which is the whole of this restructuring —
  // `ENUM_TOKEN`'s negation used to run first and rejected `<option value="0">`
  // before this branch was reached, so the ladder's own primary evidence was
  // vetoed by its weakest signal, in a position no review of the ranking could
  // see.
  const constraint = key === undefined ? undefined : uiConstraints?.get(key.toLowerCase());
  // empty: `distinct` is non-empty from the precondition above
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

  // ---- rank 3: near-unique per record → not an enum.
  //
  // Free text or an identifier. An observation about the data rather than about
  // its spelling, which is why it outranks rank 4 and not rank 2.
  if (recordCount > 1 && ratio >= UNIQUENESS_EXCLUDES_ENUM) {
    if (key !== undefined && IDENTIFIER_NAME.test(key)) {
      return { ...none, identifier: { pathParamOf: [], evidence: ['identifier-name', 'unique-per-record'] } };
    }
    return none;
  }

  // ---- rank 4: prose is never a domain → not an enum.
  //
  // Tests for sentences, which is what §7.5 names. The previous test was
  // `!ENUM_TOKEN.test(v)` — far wider, and its width is the defect: `"0"`,
  // `"v0.24.6"` and `"en-US"` are not prose and all three were excluded here.
  // Slug-likeness is rank 5's business and appears there.
  // empty: `distinct` is non-empty from the precondition above
  if (distinct.some((v) => SENTENCE_LIKE.test(v))) return none;

  // ---- rank 5: cardinality stayed flat, and the values look like a domain.
  //
  // Read statically, because one capture yields a final count rather than a
  // trajectory — which is what the floor and the ratio encode. `ENUM_TOKEN` is
  // required *here*, as a positive signal supporting the weakest positive
  // branch, and nowhere else.
  // empty: `distinct` is non-empty from the precondition above
  if (
    distinct.length >= 2 &&
    recordCount >= ENUM_MIN_DISTINCT_RECORDS &&
    distinct.length <= recordCount * ENUM_MAX_VALUE_RATIO &&
    distinct.every((v) => ENUM_TOKEN.test(v))
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
