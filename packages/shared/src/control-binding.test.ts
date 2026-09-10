/**
 * The ranked evaluator, driven to each verdict on synthetic input.
 *
 * The rung *table* is per-problem and tested where it lives; what is tested
 * here is the property the ladder restructure bought (0033 §4.2): the order is
 * the declared rank, there is nothing above the list, and a decline is a
 * decision rather than a silence.
 */
import { describe, expect, it } from 'vitest';
import {
  assessControlBindings,
  type BindingRung,
  type UrlTarget,
} from './index.js';

interface C {
  controlId: string;
  gapId: string;
  kind: string;
}
const control = (controlId: string, kind: string): C => ({ controlId, gapId: 'gap_1', kind });

const binds = (rank: number, id: string, on: string, path: string): BindingRung<C, UrlTarget> => ({
  rank,
  id,
  run: (c) =>
    c.kind === on || c.kind === `${on}+`
      ? { kind: 'bind', target: { kind: 'url', path, method: 'GET' }, detail: `${id} fired` }
      : null,
});
const declines = (rank: number, id: string, on: string): BindingRung<C, UrlTarget> => ({
  rank,
  id,
  run: (c) =>
    c.kind === on || c.kind.startsWith(`${on}+`)
      ? { kind: 'decline', reason: id, detail: `${id} refused` }
      : null,
});

describe('the ranked evaluator', () => {
  it('lets the lowest-numbered rung that speaks decide', () => {
    const report = assessControlBindings({
      controls: [control('c1', 'a+')],
      rungs: [binds(4, 'weak', 'a', '/weak'), binds(3, 'strong', 'a', '/strong')],
    });
    expect(report.bound[0]!.rank).toBe(3);
    expect(report.bound[0]!.target.path).toBe('/strong');
  });

  it('keeps EVERY rung that fired, not only the winner', () => {
    // 0030 §1: "rank 2 agreed with rank 4" is a different claim from "rank 2
    // fired", and `NarrowingRecord` keeps both for the same reason.
    const report = assessControlBindings({
      controls: [control('c1', 'a+')],
      rungs: [binds(4, 'weak', 'a', '/weak'), binds(3, 'strong', 'a', '/strong')],
    });
    expect(report.bound[0]!.evidence.map((e) => e.rung)).toEqual(['strong', 'weak']);
  });

  it('ORDERS BY DECLARED RANK, not by position in the array', () => {
    // The unranked-veto bug recreated by accident: if array order decided,
    // `weak` would be listed first and would win.
    const report = assessControlBindings({
      controls: [control('c1', 'a+')],
      rungs: [binds(9, 'weak', 'a', '/weak'), binds(1, 'strong', 'a', '/strong')],
    });
    expect(report.bound[0]!.rank).toBe(1);
    expect(report.bound[0]!.target.path).toBe('/strong');
    // And the evidence is in rank order too, not array order.
    expect(report.bound[0]!.evidence.map((e) => e.rank)).toEqual([1, 9]);
  });

  it('THROWS when two rungs share a rank, rather than letting order decide', () => {
    expect(() =>
      assessControlBindings({
        controls: [],
        rungs: [binds(2, 'x', 'a', '/x'), binds(2, 'y', 'a', '/y')],
      }),
    ).toThrow(/share a rank/);
  });

  it('DECLINES rather than falling through to a lower-ranked binder', () => {
    // The whole reason decline is not null: a `<form action="https://external/">`
    // is a rank-3 hit and must not bind.
    const report = assessControlBindings({
      controls: [control('c1', 'ext+a')],
      rungs: [declines(2, 'not-ours', 'ext'), binds(3, 'form-action', 'a', '/should-not-bind')],
    });
    expect(report.bound).toEqual([]);
    expect(report.declined).toEqual([
      { controlId: 'c1', rank: 2, rung: 'not-ours', reason: 'not-ours', detail: 'not-ours refused' },
    ]);
  });

  it('leaves a control no rung spoke for unbound, so the gap stands alone', () => {
    const report = assessControlBindings({
      controls: [control('c1', 'silent')],
      rungs: [binds(3, 'form-action', 'a', '/x')],
    });
    expect(report.unbound).toEqual(['c1']);
    expect(report.bound).toEqual([]);
    expect(report.declined).toEqual([]);
  });

  it('reports rungs that never fired, so a rung nobody can prove fires is visible', () => {
    const report = assessControlBindings({
      controls: [control('c1', 'a+')],
      rungs: [binds(3, 'fires', 'a', '/x'), binds(5, 'never', 'zzz', '/y')],
    });
    expect(report.silentRungs).toEqual(['never']);
  });

  it('reports how many controls it considered, so nothing-offered differs from nothing-bound', () => {
    const empty = assessControlBindings({ controls: [], rungs: [binds(3, 'f', 'a', '/x')] });
    expect(empty.bound).toEqual([]);
    expect(empty.considered).toBe(0);
    const some = assessControlBindings({
      controls: [control('c1', 'silent')],
      rungs: [binds(3, 'f', 'a', '/x')],
    });
    expect(some.bound).toEqual([]);
    expect(some.considered).toBe(1);
  });
});

/**
 * The negative control (§13): a perturbation the evaluator could plausibly key
 * on and must not.
 *
 * A table of nothing but firing rows is satisfied by an evaluator that binds
 * whenever anything speaks. Adding a *lower-priority* rung must not change a
 * decision already made at a better rank — that is the property "ranked" means,
 * and an evaluator that took the last speaker would pass every row above.
 */
describe('control — adding a weaker rung does not move a decision', () => {
  it('leaves the winning rank and target exactly where they were', () => {
    const rungs = [binds(3, 'strong', 'a', '/strong')];
    const before = assessControlBindings({ controls: [control('c1', 'a+')], rungs });
    const after = assessControlBindings({
      controls: [control('c1', 'a+')],
      rungs: [...rungs, binds(8, 'weaker', 'a', '/weaker')],
    });
    expect(after.bound[0]!.rank).toBe(before.bound[0]!.rank);
    expect(after.bound[0]!.target).toEqual(before.bound[0]!.target);
    // …and the weaker rung is still recorded, which is the other half.
    expect(after.bound[0]!.evidence.map((e) => e.rung)).toEqual(['strong', 'weaker']);
  });
});
