/**
 * The `inference` suite (0023): scoring `model.entities`, which until now no
 * metric read at all.
 *
 * 0021 measured that every `capture-fidelity` category scores a capture
 * artifact — the same capture inferred with each of infer's pieces disabled
 * moved not one of them. This is the half that moves: the ablation that turns
 * entity dedup off takes `entity-identity.precision` from 1.000 to 0.571, which
 * is the first number in this project to respond to a piece of stage 2.
 *
 * Three properties carry it, each one lifted from `match.ts` deliberately
 * rather than reinvented:
 *
 * 1. **Pairing is through the matched operation, never by name.**
 *    `entityNameFor` derives a name from a path segment and cannot know the
 *    document says `models.Project`. Folding naming into identity would make
 *    every entity a miss for a cosmetic reason and bury the real ones — the
 *    argument that keeps `path-param-naming` its own category.
 * 2. **One-to-one, and an ambiguity is a miss on both sides.** Never resolved by
 *    picking the better-scoring pair, which is the grader grading itself.
 * 3. **The precision denominator counts entity *objects*, not distinct names.**
 *    Learned by getting it wrong: keying the pairing by `effect.entity` made the
 *    seven entities the no-dedup ablation emits — four distinct names between
 *    them — collapse into four keys, and the metric reported *identical* numbers
 *    for both models. An aggregate hiding a partial loss (§13), in the
 *    denominator.
 */
import type { Entity, SiteModel } from '@siteforge/schema';
import type { Matching } from './match.js';
import type { TruthEntity, TruthField, TruthModel } from './truth/swagger2.js';

export interface EntityPair {
  /** The document's name for it. Scored by nothing; used to report. */
  readonly truth: TruthEntity;
  /** Every model entity carrying this name. More than one is the redundancy. */
  readonly entities: readonly Entity[];
}

export interface EntityMatching {
  readonly pairs: readonly EntityPair[];
  /** Model entity objects reachable from a matched operation — the denominator. */
  readonly inScope: readonly Entity[];
  /** Keys where either side offered more than one candidate. */
  readonly ambiguous: readonly string[];
  /** Truth entities reachable as a row of a matched operation. */
  readonly truthReachable: readonly TruthEntity[];
  /**
   * Reachable definitions no model entity paired with. Reported, never gated.
   *
   * **Deliberately not called "entities infer missed", because the grader
   * cannot tell why.** Its inputs are a model, a truth and a list of
   * `(method, pathPattern)` — it never sees a response body, so "the collection
   * came back empty" and "infer declined a token mint" are indistinguishable
   * from here. The first draft of this field claimed the former and reported
   * six where three were true, which is exactly the conflation 0023 §3.1
   * warns about, committed inside the check written to avoid it.
   *
   * So the number is the unattributed miss set and the name says so.
   * Attribution needs the capture's bodies and was done by hand in 0023 §3.1:
   * of these six, three were empty collections and three were a token mint, a
   * delete envelope and a capability blob that §7 says to decline. That is why
   * `entity-identity.recall` is `notDerived` rather than a metric.
   */
  readonly unpairedReachable: readonly string[];
}

/**
 * Compare a model field name with a declared property name.
 *
 * Lowercased, non-alphanumerics removed. Fixed here before any score, in the
 * spirit of 0015 §3's `integer`/`number` normalisation: the model spells fields
 * camelCase and this document spells properties snake_case, so `hexColor` and
 * `hex_color` are the same claim.
 *
 * Deliberately **not** by calling infer's `fieldNameOf`. A grader that shares
 * the transform it is scoring moves both sides when that transform is wrong —
 * §13's rule about an invariant's observed side, applied to a grader.
 */
export const canonicalFieldName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which entity an operation's rows are, where its effect names one. */
const effectEntity = (operation: { effect: object }): string | null =>
  'entity' in operation.effect && typeof operation.effect.entity === 'string'
    ? operation.effect.entity
    : null;

export function matchEntities(
  model: SiteModel,
  matching: Matching,
  truth: TruthModel,
): EntityMatching {
  /** Model entity name → the definitions its operations return. */
  const claimed = new Map<string, Set<string>>();
  /** Definition name → the model entity names claiming it. */
  const claimants = new Map<string, Set<string>>();
  /** Definitions a matched operation returns, and whether the model paired one. */
  const rowObserved = new Map<string, boolean>();

  for (const pair of matching.pairs) {
    const definition = pair.truth.rowDefinition;
    if (definition === null) continue;
    const entity = effectEntity(pair.operation);
    // A definition is reachable because a matched operation returns it,
    // whatever the model made of that operation. Restricting the reachable set
    // to operations the model modelled would make the count a tautology.
    rowObserved.set(definition.name, (rowObserved.get(definition.name) ?? false) || entity !== null);
    if (entity === null) continue;
    const forEntity = claimed.get(entity) ?? new Set<string>();
    forEntity.add(definition.name);
    claimed.set(entity, forEntity);
    const forDefinition = claimants.get(definition.name) ?? new Set<string>();
    forDefinition.add(entity);
    claimants.set(definition.name, forDefinition);
  }

  return finish(model, truth, claimed, claimants, rowObserved);
}

function finish(
  model: SiteModel,
  truth: TruthModel,
  claimed: Map<string, Set<string>>,
  claimants: Map<string, Set<string>>,
  rowObserved: Map<string, boolean>,
): EntityMatching {
  const truthByName = new Map(truth.entities.map((e) => [e.name, e]));
  const truthReachable = [...rowObserved.keys()]
    .map((name) => truthByName.get(name))
    .filter((e): e is TruthEntity => e !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));

  const pairs: EntityPair[] = [];
  // A set, because a definition claimed by two entities is reached once per
  // claimant and is one ambiguity, not two. Reported as its own count (0015
  // §2), so double-counting it would inflate the thing being reported.
  const ambiguous = new Set<string>();
  for (const [entity, definitions] of claimed) {
    const only = [...definitions][0];
    if (definitions.size > 1 || only === undefined) {
      ambiguous.add(`${entity} → ${[...definitions].join(' | ')}`);
      continue;
    }
    const alsoClaiming = claimants.get(only) ?? new Set();
    if (alsoClaiming.size > 1) {
      // Two model entities for one declared definition: the shape an
      // under-merging dedup produces. A miss on both sides, reported as its own
      // count, never resolved by keeping the better-scoring one.
      ambiguous.add(`${only} ← ${[...alsoClaiming].join(' | ')}`);
      continue;
    }
    const definition = truthByName.get(only);
    if (definition === undefined) continue;
    pairs.push({ truth: definition, entities: model.entities.filter((e) => e.name === entity) });
  }

  return {
    pairs: pairs.sort((a, b) => a.truth.name.localeCompare(b.truth.name)),
    // Entity *objects*, so redundant tables sharing a name are each counted.
    inScope: model.entities.filter((e) => claimed.has(e.name)),
    ambiguous: [...ambiguous].sort(),
    truthReachable,
    unpairedReachable: [...rowObserved.entries()]
      .filter(([, paired]) => !paired)
      .map(([name]) => name)
      .sort(),
  };
}

// ---------------------------------------------------------------------------

export interface EntityTallies {
  identityPrecision: { numerator: number; denominator: number };
  fieldPrecision: { numerator: number; denominator: number };
  fieldRecall: { numerator: number; denominator: number };
  narrowingPrecision: { numerator: number; denominator: number };
  narrowingRecall: { numerator: number; denominator: number };
}

/**
 * What the model narrowed an entity field to — **enum only**.
 *
 * 0023 §3.3: this document declares zero formats, and silence about a field is
 * not a claim that the field is unconstrained. Scoring the model's 43
 * `date-time` narrowings against it would mark every correct one a false
 * positive for the document's reticence, so both sides are restricted to the
 * claim kind the document actually makes. A property of the vocabulary, not of
 * the misses it removes — the line `vocabulary.ts` is held to.
 */
const modelEnum = (narrowing: Entity['fields'][number]['narrowing']): boolean =>
  narrowing !== null && narrowing.kind === 'enum';

/**
 * Does the model's narrowing agree with the declared domain?
 *
 * **Presence and cardinality, not membership** — and that is a limitation of
 * `SiteModel` rather than a choice made here. `NarrowingRecord` for
 * `kind: 'enum'` carries the *evidence* for the narrowing — `distinctRecords`,
 * `distinctValues`, the `uiConstraint`, the review gap — and **not the value
 * set**. `EntityField.type` has no enum member either, so a narrowed entity
 * column cannot say which values it admits; the values live on the operation's
 * response schema, reachable only through the projection.
 *
 * So two things are checkable and one is not:
 *
 *   - **presence**: the model found this column's domain closed, or it did not;
 *   - **cardinality**: the model may not have observed *more* distinct values
 *     than the document declares. More means the document is stale or the
 *     narrowing is wrong, and either way the claims disagree;
 *   - membership is unavailable, so `models.Task.repeat_mode = [0,1,2]` cannot
 *     be checked against the three values the model actually saw.
 *
 * Recorded as a gap in 0023 §3.3 rather than worked around, and the direction
 * of the cardinality test is §13's: a model admitting fewer states than the real
 * system is the failure that corrupts a trajectory, so an under-count is what
 * this rejects.
 */
function enumAgrees(field: Entity['fields'][number], declared: TruthField): boolean {
  // Empty is not null and must not pass: `[].every(…)` is true, so a document
  // declaring `enum: []` would make every model claim agree with it for free.
  if (declared.enumValues === null || declared.enumValues.length === 0) return false;
  const narrowing = field.narrowing;
  if (narrowing === null || narrowing.kind !== 'enum') return false;
  // A UI constraint carries real values, so where one backs the narrowing the
  // membership test is available after all — use the stronger check.
  const offered = narrowing.uiConstraint?.optionValues;
  if (offered !== undefined && offered.length > 0) {
    const model = new Set(offered.map((v) => String(v)));
    // empty: guarded on the line above
    return declared.enumValues.every((v) => model.has(v));
  }
  return narrowing.distinctValues <= declared.enumValues.length;
}

export function scoreEntities(matching: EntityMatching): EntityTallies {
  const t: EntityTallies = {
    identityPrecision: { numerator: matching.pairs.length, denominator: matching.inScope.length },
    fieldPrecision: { numerator: 0, denominator: 0 },
    fieldRecall: { numerator: 0, denominator: 0 },
    narrowingPrecision: { numerator: 0, denominator: 0 },
    narrowingRecall: { numerator: 0, denominator: 0 },
  };

  for (const pair of matching.pairs) {
    const declared = new Map(pair.truth.properties.map((p) => [canonicalFieldName(p.pointer), p]));
    // One entity per pair by construction — an ambiguous name never gets here.
    const entity = pair.entities[0];
    if (entity === undefined) continue;
    const emitted = new Map(entity.fields.map((f) => [canonicalFieldName(f.name), f]));

    t.fieldPrecision.denominator += emitted.size;
    t.fieldRecall.denominator += declared.size;
    for (const [key, field] of emitted) {
      const counterpart = declared.get(key);
      if (counterpart === undefined) continue;
      t.fieldPrecision.numerator += 1;
      t.fieldRecall.numerator += 1;

      // Narrowing is scored over *matched* fields only: a field the model
      // invented has no declared domain to disagree with, and charging it here
      // would count one mistake twice.
      if (modelEnum(field.narrowing)) {
        t.narrowingPrecision.denominator += 1;
        if (enumAgrees(field, counterpart)) t.narrowingPrecision.numerator += 1;
      }
      if (counterpart.enumValues !== null && counterpart.enumValues.length > 0) {
        t.narrowingRecall.denominator += 1;
        if (modelEnum(field.narrowing) && enumAgrees(field, counterpart)) {
          t.narrowingRecall.numerator += 1;
        }
      }
    }
  }
  return t;
}
