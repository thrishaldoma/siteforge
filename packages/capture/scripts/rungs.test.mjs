/**
 * The rung gates, sabotaged one key at a time.
 *
 * §13: no invariant lands without a sabotage test that reintroduces the bug and
 * proves the invariant fails. The gate this file exists for is
 * `foreignAssets` — rung 2 now serves its font and one image from a second
 * origin so the crawl boundary's *allow* branch is exercised by a real request.
 * The previous version of that measurement was a console line counting foreign
 * subresources against a single-origin fixture: structurally zero, printed as
 * evidence (decision 0012).
 *
 * The sabotage is on the assertion, not on the guard. A fault-injection switch
 * that made the predicate block subresources would be a flag that weakens the
 * boundary, shipped in a repo whose §13 says never `--force` past a failing
 * gate — a worse trade than the coverage it buys.
 */
import { describe, expect, it } from 'vitest';
import { RUNGS, checkRung } from './rungs.mjs';

/** A count table in which every gate passes, for the given rung. */
const allPassing = (rung) => {
  const counts = {};
  for (const key of RUNGS[rung].expectNonEmpty) counts[key] = 1;
  for (const key of RUNGS[rung].knownEmpty) counts[key] = 0;
  for (const [key, want] of Object.entries(RUNGS[rung].expectExactly ?? {})) counts[key] = want;
  return counts;
};

describe('the rung gates fail when the thing they measure is missing', () => {
  for (const rung of Object.keys(RUNGS).map(Number)) {
    describe(`rung ${rung}`, () => {
      it('passes when every expected category produced output', () => {
        const { failures, surprises } = checkRung(rung, allPassing(rung));
        expect(failures).toEqual([]);
        expect(surprises).toEqual([]);
      });

      // Every key, not a chosen one: a gate nobody sabotages is a gate nobody
      // knows fires. This is the completeness assertion in table form — the
      // test table is generated from the rule table, so they cannot drift.
      it.each(RUNGS[rung].expectNonEmpty)('fails when %s is zero', (key) => {
        const counts = { ...allPassing(rung), [key]: 0 };
        const { failures } = checkRung(rung, counts);
        expect(failures.map((f) => f.key)).toEqual([key]);
      });

      it.each(RUNGS[rung].expectNonEmpty)('fails when %s is missing entirely', (key) => {
        const counts = { ...allPassing(rung) };
        delete counts[key];
        const { failures } = checkRung(rung, counts);
        expect(failures.map((f) => f.key)).toEqual([key]);
      });

      // An exact gate has two failure directions, and non-emptiness sees only
      // one of them. The drop that shipped was 3 -> 2: still non-zero.
      it.each(Object.keys(RUNGS[rung].expectExactly ?? {}))('fails when %s is one short', (key) => {
        const want = RUNGS[rung].expectExactly[key];
        const { failures } = checkRung(rung, { ...allPassing(rung), [key]: want - 1 });
        expect(failures.map((f) => f.key)).toEqual([key]);
      });

      it.each(Object.keys(RUNGS[rung].expectExactly ?? {}))('fails when %s is one over', (key) => {
        const want = RUNGS[rung].expectExactly[key];
        const { failures } = checkRung(rung, { ...allPassing(rung), [key]: want + 1 });
        expect(failures.map((f) => f.key)).toEqual([key]);
      });

      it.each(RUNGS[rung].knownEmpty)('reports %s as a surprise rather than failing', (key) => {
        const { failures, surprises } = checkRung(rung, { ...allPassing(rung), [key]: 1 });
        expect(failures).toEqual([]);
        expect(surprises).toEqual([key]);
      });
    });
  }

  it('rung 2 measures both halves of the crawl boundary', () => {
    // One fixture, two branches. A guard that blocked everything would pass
    // `blockedOffOriginNavigations` and fail `foreignAssets`; a guard that
    // blocked nothing would do the reverse. Neither can pass rung 2.
    expect(RUNGS[2].expectNonEmpty).toContain('foreignAssets');
    expect(RUNGS[2].expectNonEmpty).toContain('blockedOffOriginNavigations');
  });

  it('gates statesProbed exactly, because the drop it must catch is 3 to 2', () => {
    // Non-emptiness held at 2 while a state was being silently dropped every
    // run. §13 prefers equality wherever the data allows one.
    expect(RUNGS[3].expectExactly?.statesProbed).toBe(3);
    expect(RUNGS[3].expectNonEmpty).not.toContain('statesProbed');
  });

  it('rung 3 declares foreignAssets known-empty rather than omitting it', () => {
    // Omitting it would mean a single-origin fixture silently stopped being
    // measured. Declared, a non-zero count is reported as a stale declaration.
    expect(RUNGS[3].knownEmpty).toContain('foreignAssets');
  });
});
