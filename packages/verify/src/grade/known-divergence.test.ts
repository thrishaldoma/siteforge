/**
 * The committed divergence list, frozen as a complete set.
 *
 * 0015: "exclusions produced in response to a bad score cannot be distinguished
 * from tuning afterwards, however good each justification reads." The defence is
 * that the list is small, individually evidenced, and **hard to grow quietly** —
 * so this asserts the whole set rather than properties of it. §13's freeze rule:
 * `toEqual([...])` covers every edge there could be; `not.toContain(x)` covers
 * the one somebody thought of.
 *
 * This file also stops being vacuous today. 0015 flagged that the real list was
 * empty and "an assertion over an empty list is the vacuous check this repo has
 * now found five times". It is non-empty for the first time.
 */
import { describe, expect, it } from 'vitest';
import { KnownDivergenceSchema, assessDivergenceBudget } from '@siteforge/schema';
import { KNOWN_DIVERGENCE } from './known-divergence.js';

describe('the known-divergence list', () => {
  it('parses, evidence and all', () => {
    for (const entry of KNOWN_DIVERGENCE) {
      expect(KnownDivergenceSchema.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
    }
  });

  it('is exactly these four slots', () => {
    // The complete set, so a fifth cannot arrive without this line being edited
    // by a person who has read 0033 §3.1 and decided the concentration is still
    // acceptable.
    expect(
      KNOWN_DIVERGENCE.map((e) =>
        e.scope === 'field' ? `${e.method} ${e.specPath} ${e.status} ${e.pointer}` : `${e.method} ${e.specPath}`,
      ),
    ).toEqual([
      'GET /projects 200 /[]/views/[]/view_kind',
      'GET /projects 200 /[]/views/[]/bucket_configuration_mode',
      'GET /projects/{id} 200 /views/[]/view_kind',
      'GET /projects/{id} 200 /views/[]/bucket_configuration_mode',
    ]);
  });

  it('excludes only from narrowing, and only at field scope', () => {
    // An endpoint-scope entry would remove the whole of `GET /api/v1/projects`
    // from a category — dozens of correctly-scored fields, four other categories
    // moved by an entry naming none of them. 0033 §2.
    expect([...new Set(KNOWN_DIVERGENCE.map((e) => e.scope))]).toEqual(['field']);
    expect([...new Set(KNOWN_DIVERGENCE.map((e) => e.category))]).toEqual(['narrowing']);
  });

  it('keeps the endpoint-scope list empty and therefore inside the global cap', () => {
    // The two units cannot borrow from each other (0033 §3). If an endpoint
    // entry ever lands, this is where the global cap starts mattering again.
    const budget = assessDivergenceBudget(KNOWN_DIVERGENCE, 21, new Map([['narrowing', 9]]));
    expect(budget.perCategory).toEqual([]);
    expect(budget.overCap).toBe(false);
  });

  it('is over the per-category field budget, and says so rather than hiding it', () => {
    // Asserted deliberately, not tolerated. 0033 §3.1: on a 9-slot category the
    // 5% cap is 0.45, so any entry concentrates — and that is the correct amount
    // of scrutiny for a category where one exclusion moves the score by 11
    // points. The signal firing is the policy working, and pinning it here means
    // a future change that silences it fails.
    const budget = assessDivergenceBudget(KNOWN_DIVERGENCE, 21, new Map([['narrowing', 9]]));
    expect(budget.perCategoryFields).toEqual([
      { category: 'narrowing', count: 4, denominator: 9, cap: 0.45, overCap: true, concentrated: true },
    ]);
    expect(budget.messages.join(' ')).toContain('not fit for grading narrowing');
  });

  it('fails closed when a category has no denominator to budget against', () => {
    // `[].every(…)`'s shape in a different costume: a missing denominator must
    // not read as "under cap". §13 — an empty container fails closed or throws.
    const budget = assessDivergenceBudget(KNOWN_DIVERGENCE, 21, new Map());
    expect(budget.perCategoryFields[0]).toMatchObject({ denominator: 0, cap: 0, overCap: true });
  });
});
