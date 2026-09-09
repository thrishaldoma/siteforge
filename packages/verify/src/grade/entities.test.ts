/**
 * The entity pairing, driven to the verdicts the mutation harness cannot reach.
 *
 * The harness in `mutations.ts` perturbs the real baseline and is the evidence
 * that each `inference` metric fires. What it cannot produce is the *other*
 * ambiguity direction — one model entity claiming two definitions — because no
 * legal perturbation of the Gitea baseline puts one entity behind two
 * operations returning different types. So it arrives here as a parameter,
 * which is 0018's rule: a gate that can only be run against the input it passes
 * on is a gate nobody can prove fires.
 */
import { describe, expect, it } from 'vitest';
import type { SiteModel } from '@siteforge/schema';
import { canonicalFieldName, matchEntities, scoreEntities } from './entities.js';
import type { Matching } from './match.js';
import type { TruthEntity, TruthModel } from './truth/swagger2.js';

/** A definition, with only the fields the pairing and scoring read. */
const definition = (name: string, properties: string[], enums: Record<string, string[]> = {}): TruthEntity => ({
  name,
  properties: properties.map((pointer) => ({
    pointer,
    type: 'string',
    format: null,
    enumValues: enums[pointer] ?? null,
    required: false,
  })),
  operations: [],
  fromList: false,
});

const field = (name: string, narrowing: SiteModel['entities'][number]['fields'][number]['narrowing'] = null) => ({
  name,
  type: 'string' as const,
  optional: true,
  generatedBy: 'none' as const,
  narrowing,
  pathParamOf: [],
});

const entity = (name: string, fields: string[], narrowed: Record<string, number> = {}) => ({
  name,
  key: { field: fields[0]!, kind: 'surrogate' as const },
  fields: fields.map((f) =>
    narrowed[f] === undefined
      ? field(f)
      : field(f, {
          kind: 'enum' as const,
          distinctRecords: 40,
          distinctValues: narrowed[f]!,
          uiConstraint: null,
          reviewRequired: true as const,
          gapId: 'gap_000000000001',
        }),
  ),
  relations: [],
  seed: null,
});

/** A model carrying only what the entity pairing reads. */
const model = (entities: ReturnType<typeof entity>[]): SiteModel =>
  ({ entities } as unknown as SiteModel);

/** A matching carrying only the pairs, each one an operation → definition link. */
const matching = (
  pairs: Array<{ entity: string | null; definition: string | null }>,
): Matching =>
  ({
    pairs: pairs.map((p) => ({
      operation: { effect: p.entity === null ? { kind: 'custom' } : { kind: 'list', entity: p.entity } },
      truth: { rowDefinition: p.definition === null ? null : { name: p.definition, fromList: true } },
    })),
  } as unknown as Matching);

const truth = (entities: TruthEntity[]): TruthModel => ({ entities } as unknown as TruthModel);

describe('pairing is one-to-one, and an ambiguity is a miss on both sides', () => {
  it('pairs an entity to the definition its operation returns', () => {
    const result = matchEntities(
      model([entity('Project', ['id', 'title'])]),
      matching([{ entity: 'Project', definition: 'models.Project' }]),
      truth([definition('models.Project', ['id', 'title'])]),
    );
    expect(result.pairs.map((p) => p.truth.name)).toEqual(['models.Project']);
    expect(scoreEntities(result).identityPrecision).toEqual({ numerator: 1, denominator: 1 });
  });

  it('refuses to pair when TWO entities claim one definition', () => {
    // The under-merge an over-strict shape identity produces, and the direction
    // the real ablation exercises.
    const result = matchEntities(
      model([entity('Project', ['id']), entity('ProjectRow', ['id'])]),
      matching([
        { entity: 'Project', definition: 'models.Project' },
        { entity: 'ProjectRow', definition: 'models.Project' },
      ]),
      truth([definition('models.Project', ['id'])]),
    );
    expect(result.pairs).toEqual([]);
    expect(result.ambiguous).toEqual(['models.Project ← Project | ProjectRow']);
    // Both sides a miss, never resolved by keeping the better-scoring one.
    expect(scoreEntities(result).identityPrecision).toEqual({ numerator: 0, denominator: 2 });
  });

  it('refuses to pair when ONE entity claims two definitions', () => {
    // The other direction, and the one no legal perturbation of the baseline
    // reaches — an over-merge, where one table is claimed to back two declared
    // types. Reported as its own count rather than resolved.
    const result = matchEntities(
      model([entity('Row', ['id'])]),
      matching([
        { entity: 'Row', definition: 'models.Project' },
        { entity: 'Row', definition: 'models.Task' },
      ]),
      truth([definition('models.Project', ['id']), definition('models.Task', ['id'])]),
    );
    expect(result.pairs).toEqual([]);
    expect(result.ambiguous).toEqual(['Row → models.Project | models.Task']);
  });

  it('counts entity OBJECTS in scope, not distinct names', () => {
    // §13 in the denominator. Three tables sharing one name is what the
    // no-dedup ablation emits, and keying the denominator on names made the
    // metric report the same score for both models.
    const result = matchEntities(
      model([entity('Row', ['id']), entity('Row', ['id']), entity('Row', ['id'])]),
      matching([{ entity: 'Row', definition: 'models.Task' }]),
      truth([definition('models.Task', ['id'])]),
    );
    expect(result.inScope).toHaveLength(3);
    expect(scoreEntities(result).identityPrecision).toEqual({ numerator: 1, denominator: 3 });
  });

  it('reports an unpaired reachable definition without claiming why', () => {
    // The grader sees no response body, so "the collection was empty" and
    // "infer correctly declined an envelope" are indistinguishable from here.
    // The field is named for what it measures and the first draft was not.
    const result = matchEntities(
      model([]),
      matching([{ entity: null, definition: 'models.Team' }]),
      truth([definition('models.Team', ['id'])]),
    );
    expect(result.unpairedReachable).toEqual(['models.Team']);
    expect(result.truthReachable.map((e) => e.name)).toEqual(['models.Team']);
  });
});

describe('field comparison crosses the naming conventions, and nothing else', () => {
  it('matches camelCase against snake_case', () => {
    expect(canonicalFieldName('hexColor')).toBe(canonicalFieldName('hex_color'));
    // And does not collapse two genuinely different fields.
    expect(canonicalFieldName('dueDate')).not.toBe(canonicalFieldName('due_at'));
  });

  it('scores every declared property, object and array included', () => {
    const result = matchEntities(
      model([entity('Task', ['id', 'createdBy'])]),
      matching([{ entity: 'Task', definition: 'models.Task' }]),
      truth([definition('models.Task', ['id', 'created_by', 'labels'])]),
    );
    const tallies = scoreEntities(result);
    // `createdBy` is a legitimate `json` column, so it is a hit and not a
    // precision miss; `labels` is a real recall miss because infer dropped it.
    expect(tallies.fieldPrecision).toEqual({ numerator: 2, denominator: 2 });
    expect(tallies.fieldRecall).toEqual({ numerator: 2, denominator: 3 });
  });
});

describe('narrowing agreement is presence and cardinality, never invented', () => {
  it('accepts a narrowing no wider than the declared domain', () => {
    const result = matchEntities(
      model([entity('View', ['id', 'kind'], { kind: 3 })]),
      matching([{ entity: 'View', definition: 'models.ProjectView' }]),
      truth([definition('models.ProjectView', ['id', 'kind'], { kind: ['0', '1', '2', '3'] })]),
    );
    expect(scoreEntities(result).narrowingPrecision).toEqual({ numerator: 1, denominator: 1 });
    expect(scoreEntities(result).narrowingRecall).toEqual({ numerator: 1, denominator: 1 });
  });

  it('rejects a narrowing that admits FEWER states than the document declares', () => {
    // §13's direction: an enum omitting a value the real system allows makes
    // that state unrepresentable in the clone. Cardinality is the only test
    // available, because `NarrowingRecord` carries the evidence and not the
    // values — recorded as a SiteModel gap in 0023 §3.3.
    const result = matchEntities(
      model([entity('View', ['id', 'kind'], { kind: 9 })]),
      matching([{ entity: 'View', definition: 'models.ProjectView' }]),
      truth([definition('models.ProjectView', ['id', 'kind'], { kind: ['0', '1'] })]),
    );
    expect(scoreEntities(result).narrowingPrecision).toEqual({ numerator: 0, denominator: 1 });
  });

  it('never agrees with an empty declared domain', () => {
    // `[].every(…)` is true, so a document declaring `enum: []` would make
    // every model claim agree for free — the empty-admits family.
    const result = matchEntities(
      model([entity('View', ['id', 'kind'], { kind: 3 })]),
      matching([{ entity: 'View', definition: 'models.ProjectView' }]),
      truth([definition('models.ProjectView', ['id', 'kind'], { kind: [] })]),
    );
    const tallies = scoreEntities(result);
    expect(tallies.narrowingPrecision).toEqual({ numerator: 0, denominator: 1 });
    // And an empty declaration is not a claim to have missed, either.
    expect(tallies.narrowingRecall).toEqual({ numerator: 0, denominator: 0 });
  });
});
