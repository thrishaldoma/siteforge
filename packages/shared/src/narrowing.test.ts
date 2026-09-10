/**
 * §7.5's ladder, and the rule that it is the whole ladder.
 *
 * `ENUM_TOKEN`'s negation sat above the ranking as a "hard exclusion, regardless
 * of the above", where it rejected 161 of 273 observed string fields before any
 * evidence was weighed — including every numeric-coded domain, since it requires
 * a leading letter. So a `<select>` offering `<option value="0">`, which §7.5
 * calls "ground truth about the domain, and the only evidence that is", could
 * never narrow anything, on any target.
 *
 * Nobody reviewing the ranking could have seen it, because it was not in the
 * ranking. These tests assert the *order*, entry by entry, so the next condition
 * that wants to veto a branch has to argue a rank first.
 */
import { describe, expect, it } from 'vitest';
import { classifyStringField } from './narrowing.js';

describe('the ladder has no unranked veto above it (§7.5, 0036)', () => {
  const mintGap = () => 'gap_test';
  const run = (over: Partial<Parameters<typeof classifyStringField>[0]>) =>
    classifyStringField({
      key: 'mode', distinct: [], recordCount: 0, mintGap, ...over,
    } as Parameters<typeof classifyStringField>[0]);

  const control = (optionValues: string[]) =>
    new Map([['mode', { control: 'select' as const, routeId: 'r--c--i0', nodeId: 'n_0', optionValues }]]);

  it('lets a UI constraint narrow a domain of numeric codes', () => {
    // The behaviour the restructuring changes, and the reason for it. `"0"` is
    // not slug-like, and under the old order `!ENUM_TOKEN.test('0')` returned
    // `none` before rank 2 ran — so a <select> offering exactly these values,
    // which is ground truth that the API receives them, lost to a guess about
    // spelling.
    const out = run({
      distinct: ['0', '1', '2'], recordCount: 5, uiConstraints: control(['0', '1', '2']),
    });
    expect(out.enumValues).toEqual(['0', '1', '2']);
    expect(out.narrowing?.uiConstraint?.optionValues).toEqual(['0', '1', '2']);
  });

  it('still refuses those values with no control behind them', () => {
    // The negative case, and the one that keeps this from being a loosening:
    // rank 5 requires slug shape, so numeric codes with only cardinality behind
    // them are not an enum. Nothing was widened except what rank 2 can reach.
    const out = run({ distinct: ['0', '1', '2'], recordCount: 40 });
    expect(out.enumValues).toBeNull();
  });

  it('keeps a path parameter above the control that offers it', () => {
    // Rank 1. A key a <select> also happens to offer is still a key — §7.4
    // reads foreign keys from exactly this overlap.
    const out = run({
      distinct: ['7'], recordCount: 5,
      uiConstraints: control(['7', '8']),
      pathParamValues: new Map([['7', new Set(['get-projects-id'])]]),
    });
    expect(out.enumValues).toBeNull();
    expect(out.identifier?.pathParamOf).toEqual(['get-projects-id']);
  });

  it('excludes prose, and only prose', () => {
    // Rank 4 now tests what §7.5 names. `ENUM_TOKEN`'s negation stood in for it
    // and rejected 161 of 273 observed string fields, most of them not prose.
    expect(run({ distinct: ['please choose one'], recordCount: 40 }).enumValues).toBeNull();
    // Not prose, and not slug-like either — so it still fails, at rank 5 rather
    // than rank 4. Same verdict, honest reason.
    expect(run({ distinct: ['v0.24.6'], recordCount: 40 }).enumValues).toBeNull();
  });

  it('lets a control outrank prose, because a control is ground truth', () => {
    // Deliberate, and the sharpest case for ranking the exclusions rather than
    // stacking them: if the UI offers a sentence as an option value, the API can
    // receive that sentence. Rank 2 is an observation; rank 4 is an inference
    // about spelling.
    const out = run({
      distinct: ['I agree to the terms'], recordCount: 5,
      uiConstraints: control(['I agree to the terms', 'I do not']),
    });
    expect(out.enumValues).toEqual(['I agree to the terms', 'I do not']);
  });
});
