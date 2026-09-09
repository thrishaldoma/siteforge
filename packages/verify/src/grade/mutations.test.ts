/**
 * The mutation harness, run — and then the harness's own table checks, driven
 * by tables that break them.
 *
 * Two levels, and the second is the one this repo keeps learning it needs. The
 * first says the grader notices twenty specific defects. The second says the
 * rules deciding whether that table is *well formed* actually fire, because
 * `assessMutationTable` against the real table returns `[]` every time and a
 * check that only ever sees a passing input is a check nobody can prove works.
 */
import { describe, expect, it } from 'vitest';
import { GRADE_CATEGORIES, GRADE_METRICS } from '@siteforge/schema';
import { GITEA_BASELINE, GITEA_OBSERVED } from './baseline/gitea.js';
import { loadGiteaTruth } from './truth/gitea.js';
import type { GradeInput } from './grade.js';
import { MUTATIONS, assessMutationTable, runMutationHarness, type Mutation } from './mutations.js';

const input: GradeInput = {
  model: GITEA_BASELINE,
  truth: loadGiteaTruth(),
  observed: GITEA_OBSERVED,
  divergence: [],
};

const harness = runMutationHarness(input);

describe('the baseline is a legal model, not a transcription of the answer key', () => {
  it('parses against SiteModelSchema, narrowing evidence and all', () => {
    // Parsing happens at import; reaching this line is the assertion. Decision
    // 0011: a fixture in a shape its producing stage cannot produce is a lie.
    expect(GITEA_BASELINE.operations.length).toBeGreaterThan(10);
    expect(GITEA_BASELINE.artifact).toBe('site-model');
  });

  it('scores 1.000 on every claim it makes, which is evidence of nothing', () => {
    // 0015 §7, stated as a test so nobody reads the baseline table as a result.
    // It was transcribed from the ground truth, so every perfect score is
    // circular by construction. The deltas below are the finding.
    //
    // 18 after 0023: the five gradeable `inference` metrics joined the thirteen
    // `capture-fidelity` ones. The count is asserted rather than a floor so a
    // metric quietly dropping out of the scored set fails here.
    const scored = harness.baseline.metrics.filter((m) => !m.vacuous);
    expect(scored.filter((m) => m.value === 1)).toHaveLength(18);
    expect(scored.find((m) => m.id === 'auth.under-gate-count')?.value).toBe(0);
  });

  it('and still fails only where a truth side does not exist', () => {
    // Every remaining shortfall is a truth side nobody built or nobody can
    // build, never a claim the model got wrong. Asserted as the complete set of
    // failing metric ids, so a real regression cannot hide among them.
    //
    // 0023 added two: `entity-identity.recall`, because Swagger 2.0 does not
    // declare which definitions are tables, and `entity-relation`, whose only
    // declarable associations are shapes `RelationSchema` cannot express. Both
    // are ungated and both still fail, because §6 scores vacuity as a failure —
    // the same treatment `identifier` has had since 0018, and a red that says
    // "unbuilt" rather than "wrong".
    expect(harness.baseline.metrics.filter((m) => !m.passed).map((m) => m.id)).toEqual([
      'identifier.precision',
      'identifier.recall',
      'entity-identity.recall',
      'entity-relation.precision',
      'entity-relation.recall',
    ]);
    // In the contract's own category order, which is the metric table's.
    expect(harness.baseline.failedCategories).toEqual([
      'identifier',
      'entity-identity',
      'entity-relation',
    ]);
  });

  it('covers a slice of the spec, and the report says how much', () => {
    expect(harness.baseline.crawlCoverage.observed).toBe(14);
    expect(harness.baseline.crawlCoverage.specTotal).toBe(482);
  });
});

describe('every mutation moves the metric it names', () => {
  it.each(MUTATIONS.map((m) => m.id))('%s', (id) => {
    const result = harness.results.find((r) => r.mutation.id === id)!;
    expect(result.failures).toEqual([]);
  });

  it('and at least one of them holds every score exactly', () => {
    // §13, the rule without which the table above proves nothing: a grader that
    // drops every number on any change satisfies all of it.
    const controls = harness.results.filter((r) => r.mutation.mustHold === 'all');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const moved = control.deltas.filter(
        (d) => d.before !== d.after || d.beforeVacuous !== d.afterVacuous,
      );
      expect(moved, `${control.mutation.id} moved ${moved.map((m) => m.metric).join(', ')}`).toEqual([]);
    }
  });

  it('the renamed parameter moves naming and leaves identity exactly where it was', () => {
    // 0015 §8 names this row specifically. Identity is scored on the positional
    // shape, so a parameter's spelling must be invisible to it.
    const result = harness.results.find((r) => r.mutation.id === 'path-param-renamed')!;
    const delta = (id: string) => result.deltas.find((d) => d.metric === id)!;
    expect(delta('path-param-naming.accuracy').after).toBeLessThan(1);
    expect(delta('endpoint-identity.precision').after).toBe(1);
    expect(delta('endpoint-identity.conservation').after).toBe(1);
  });

  it('an emptied side reports nothing rather than 1.0', () => {
    for (const id of ['truth-emptied', 'model-emptied']) {
      const result = harness.results.find((r) => r.mutation.id === id)!;
      expect(result.failures).toEqual([]);
      expect(result.report.metrics.filter((m) => m.value === 1)).toEqual([]);
    }
  });

  it('every blocked row is blocked by a fact in the truth, not by a note', () => {
    // Each turns itself back on the day its truth side lands: `staleBlocks`
    // names any row whose category is no longer ungrounded, and the harness
    // fails until the block is lifted. §13 — a known gap is a failing gate or
    // it is not tracked.
    expect(harness.staleBlocks).toEqual([]);
    const blocked = harness.results.filter((r) => r.blocked).map((r) => r.mutation.id);
    expect(blocked).toEqual(['identifier-mispointed', 'entity-relation-mispointed']);
    for (const category of ['identifier', 'entity-relation']) {
      expect(harness.baseline.notDerived.map((n) => n.category)).toContain(category);
    }
  });
});

describe('the table itself is well formed, and the rule saying so can fail', () => {
  const REACHABLE = 'a real inference pass plausibly arrives here, for this stated reason';
  const row = (over: Partial<Mutation> = {}): Mutation => ({
    id: 'x',
    change: 'something',
    reachable: REACHABLE,
    mustMove: [{ metric: 'endpoint-identity.precision', direction: 'down', minimum: 0.1 }],
    mustHold: ['endpoint-identity.conservation'],
    apply: (i) => i,
    ...over,
  });

  /**
   * A table naming every scored category **and** moving every conservation
   * metric, so a test can break one thing at a time.
   *
   * Both completeness rules, because a helper that satisfies only one of them
   * cannot tell which rule a failure came from — and the conservation rows are
   * derived from the contract rather than typed out, so a second conservation
   * metric is covered the day it lands (§13's freeze-as-a-complete-set rule).
   */
  const complete = (): Mutation[] => [
    ...GRADE_CATEGORIES.map((category) => {
      const metric = GRADE_METRICS.find((m) => m.category === category)!;
      return row({
        id: `moves-${category}`,
        mustMove: [{ metric: metric.id, direction: 'down', minimum: 0.1 }],
        mustHold: [],
      });
    }),
    ...GRADE_METRICS.filter((m) => m.conservation !== undefined).map((m) =>
      row({
        id: `moves-${m.id}`,
        mustMove: [{ metric: m.id, direction: 'down', minimum: 0.1 }],
        mustHold: [],
      }),
    ),
  ];

  it('accepts the real table', () => {
    expect(harness.tableProblems).toEqual([]);
  });

  it('objects when a conservation metric has no mutation that moves it', () => {
    // 0022's label says which defect moves `endpoint-identity.conservation`.
    // That claim lives in a docstring, and a claim in a docstring is 0012's
    // gap-recorded-only-in-prose — so the rule checks it, and this drives the
    // rule to its failing verdict by dropping exactly that row.
    const withoutIt = complete().filter((m) => !m.id.startsWith('moves-endpoint-identity.'));
    const problems = assessMutationTable(withoutIt);
    expect(problems.join('\n')).toMatch(/labelled a conservation check but no mutation moves it/);
  });

  it('accepts a synthetic table that names every category and has a control', () => {
    const table = [...complete(), row({ id: 'control', mustMove: [], mustHold: 'all' })];
    expect(assessMutationTable(table)).toEqual([]);
  });

  it('objects when a scored category has no mutation', () => {
    const table = complete().filter((m) => m.id !== 'moves-narrowing');
    table.push(row({ id: 'control', mustMove: [], mustHold: 'all' }));
    expect(assessMutationTable(table).join('\n')).toContain('no mutation moves narrowing');
  });

  it('objects when the table has no control', () => {
    const table = complete().map((m) => ({ ...m, mustHold: [] }));
    expect(assessMutationTable(table).join('\n')).toContain('no control declared');
  });

  it('objects to an empty table', () => {
    expect(assessMutationTable([]).join('\n')).toContain('no mutations declared');
  });

  it('objects to a row naming a metric the contract does not have', () => {
    const table = [
      ...complete(),
      row({ id: 'typo', mustMove: [{ metric: 'narrowing.f1', direction: 'down', minimum: 0.1 }], mustHold: 'all' }),
    ];
    expect(assessMutationTable(table).join('\n')).toContain('narrowing.f1');
  });

  it('objects to a row with no reachability note', () => {
    const table = [...complete(), row({ id: 'control', mustMove: [], mustHold: 'all', reachable: 'because' })];
    expect(assessMutationTable(table).join('\n')).toContain('no reachability note');
  });

  it('objects to a row that asserts nothing at all', () => {
    const table = [
      ...complete(),
      row({ id: 'control', mustMove: [], mustHold: 'all' }),
      row({ id: 'inert', mustMove: [], mustHold: [] }),
    ];
    expect(assessMutationTable(table).join('\n')).toContain('asserts nothing');
  });

  it('is not satisfied for a category by the whole-side rows alone', () => {
    // The loophole worth closing: "empty the truth" concerns every category at
    // once, so counting it would let it stand in for a category nobody perturbs.
    const table: Mutation[] = [
      ...complete().filter((m) => m.id !== 'moves-field-type'),
      row({ id: 'control', mustMove: [], mustHold: 'all' }),
      row({
        id: 'truth-emptied',
        wholeSide: true,
        mustMove: [],
        mustHold: [],
      }),
    ];
    expect(assessMutationTable(table).join('\n')).toContain('no mutation moves field-type');
  });
});
