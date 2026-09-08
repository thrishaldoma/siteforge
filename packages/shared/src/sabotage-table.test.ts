/**
 * The sabotage harness's own table checks, driven by tables that break them.
 *
 * `pnpm sabotage` refuses to run when the table is malformed: a patch on disk
 * with no entry, an entry with no patch, no defects, no controls, a control
 * naming a defect that does not exist, an entry with no reachability note. All
 * six lived inline in `main()`, where the only table they could ever see was the
 * real one — and the real one passes. Nobody had watched any of them fire.
 *
 * That is the same shape as the three vacuity modes the harness itself is built
 * to catch, one level up: an assertion whose input is fixed and correct is an
 * assertion nobody can prove works. So the checks take the table as a parameter,
 * `main()` is one caller, and this file is the other.
 */
import { describe, expect, it } from 'vitest';
// From the script, which is where the table lives. Importing it must not apply
// a patch — `main()` is guarded by the entry-point check, and the first test
// here would fail loudly if that guard were removed, because the harness
// refuses to run against this repo's own dirty tree during a test run.
// @ts-expect-error — a .mjs script with no type declarations; the shapes are asserted below.
import { SABOTAGES, assessSabotageTable, isControl } from '../../../scripts/sabotage.mjs';

interface Entry {
  id: string;
  reachable: string;
  kind?: 'control';
  controlFor?: string;
}

const REACHABLE = 'a real edit that someone plausibly makes to this code';
const defect = (id: string, over: Partial<Entry> = {}): Entry => ({ id, reachable: REACHABLE, ...over });
const control = (id: string, controlFor: string, over: Partial<Entry> = {}): Entry => ({
  id,
  reachable: REACHABLE,
  kind: 'control',
  controlFor,
  ...over,
});

const ids = (entries: readonly Entry[]): string[] => entries.map((e) => e.id);

describe('the table check, on tables that are wrong', () => {
  it('accepts a minimal well-formed table', () => {
    const table = [defect('a'), control('a-control', 'a')];
    expect(assessSabotageTable(table, ids(table))).toEqual([]);
  });

  it('objects to a patch on disk with no entry', () => {
    const table = [defect('a'), control('a-control', 'a')];
    const problems = assessSabotageTable(table, [...ids(table), 'orphan']);
    expect(problems.join('\n')).toContain('sabotage/ and the table disagree');
  });

  it('objects to an entry with no patch', () => {
    const table = [defect('a'), defect('rotted'), control('a-control', 'a')];
    expect(assessSabotageTable(table, ['a', 'a-control']).join('\n')).toContain('disagree');
  });

  it('objects to a table of controls only', () => {
    // A harness that reintroduces no bug reports success having proved nothing.
    const table = [control('a-control', 'a')];
    const problems = assessSabotageTable(table, ids(table));
    expect(problems.join('\n')).toContain('no sabotages declared');
  });

  it('objects to a table of defects only — §13, the mirror of the vacuous invariant', () => {
    const table = [defect('a'), defect('b')];
    const problems = assessSabotageTable(table, ids(table));
    expect(problems.join('\n')).toContain('no controls declared');
  });

  it('objects to a control naming a defect that does not exist', () => {
    const table = [defect('a'), control('b-control', 'b')];
    expect(assessSabotageTable(table, ids(table)).join('\n')).toContain(
      'names b, which is not a declared defect',
    );
  });

  it('objects to a control naming another control', () => {
    // A control paired with a control isolates nothing: neither one is a bug.
    const table = [defect('a'), control('x', 'a'), control('y', 'x')];
    expect(assessSabotageTable(table, ids(table)).join('\n')).toContain('which is not a declared defect');
  });

  it('objects to a missing or perfunctory reachability note', () => {
    const table = [defect('a', { reachable: 'because' }), control('a-control', 'a')];
    const problems = assessSabotageTable(table, ids(table));
    expect(problems.join('\n')).toContain('no reachability note');
  });

  it('reports every problem, not the first', () => {
    // §13: counts disaggregated to the granularity of the failure. `main()`
    // exited on the first one, so a table with three problems read as one.
    const table = [defect('a', { reachable: 'x' })];
    const problems = assessSabotageTable(table, ['a', 'orphan']);
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the real table', () => {
  it('is well formed under the same rule the harness applies', () => {
    // The real run is one caller of the rule, and it has to be exercised here
    // too: the synthetic tests above would pass against a rule the real table
    // could never satisfy.
    expect(assessSabotageTable(SABOTAGES, SABOTAGES.map((s: Entry) => s.id))).toEqual([]);
  });

  it('carries both kinds', () => {
    expect(SABOTAGES.filter((s: Entry) => !isControl(s)).length).toBeGreaterThan(5);
    expect(SABOTAGES.filter((s: Entry) => isControl(s)).length).toBeGreaterThan(0);
  });
});
