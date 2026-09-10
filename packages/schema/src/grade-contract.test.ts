/**
 * The contract is frozen, independent of the model, and its caps can fire.
 *
 * Decision 0015 §0 and §7. The two properties worth testing here are not about
 * the numbers in the table — they are about the table being unable to move
 * quietly, and about not being derived from the thing it constrains.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MODEL_VERSION,
  DIVERGENCE_CAP,
  GRADE_CATEGORIES,
  GRADE_CONTRACT_DIGEST,
  GRADE_METRICS,
  GRADE_SUITES,
  GradeCategoryIdSchema,
  GradeSuiteIdSchema,
  InferMetricsBlockSchema,
  KnownDivergenceSchema,
  METRICS_VERSION,
  StageReportSchema,
  assessDivergenceBudget,
  computeGradeContractDigest,
  inferMetricsBlock,
  type KnownDivergence,
} from './index.js';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), 'grade-contract.ts');

describe('the scored-field contract is frozen before the model it constrains', () => {
  it('the committed digest matches the table', () => {
    // Moving a threshold without updating the constant fails here, so the
    // change cannot be made quietly — it shows up in review as two lines.
    expect(computeGradeContractDigest(), 'the contract table moved without its digest')
      .toBe(GRADE_CONTRACT_DIGEST);
  });

  it('changes when a metric changes suite, or stops being a measurement', () => {
    // The digest's job is to make a quiet change loud, so what it *covers* has
    // to be exercised rather than asserted. `suite` decides what a number is a
    // claim about and `conservation` decides whether it is a claim at all —
    // either one left out of the canonical form would let a metric change
    // subject in silence. Driven by recomputing over a perturbed table, which
    // is the pure-gate form of the same check.
    const canonical = (metrics: typeof GRADE_METRICS) =>
      JSON.stringify(
        metrics.map((m) => [m.id, m.suite, m.category, m.numerator, m.denominator, m.gate, m.conservation ?? null]),
      );
    const real = canonical(GRADE_METRICS);
    const movedSuite = canonical(
      GRADE_METRICS.map((m) =>
        m.id === 'field-type.accuracy' ? { ...m, suite: 'inference' as never } : m,
      ),
    );
    const droppedLabel = canonical(GRADE_METRICS.map(({ conservation, ...m }) => m as typeof GRADE_METRICS[number]));
    expect(movedSuite, 'a metric changed suite and the digest could not see it').not.toBe(real);
    expect(droppedLabel, 'a conservation label vanished and the digest could not see it').not.toBe(real);
  });

  it('imports nothing but zod and node:crypto — the model layer least of all', () => {
    // 0015 §0: the list's value as a second derivation force on SiteModel
    // depends on being independent of it, and an import is how "independent"
    // quietly stops being true. Asserting the whole import list rather than the
    // absence of one name makes transitivity trivial: there is no local edge to
    // follow.
    const source = readFileSync(SOURCE, 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['node:crypto', 'zod']);
  });

  it('every category has at least one metric, and every metric a known category', () => {
    for (const category of GradeCategoryIdSchema.options) {
      expect(GRADE_METRICS.some((m) => m.category === category)).toBe(true);
    }
    expect(GRADE_CATEGORIES).toEqual([...new Set(GRADE_METRICS.map((m) => m.category))]);
  });

  it('names a denominator for every metric, because three bare rates get averaged', () => {
    for (const metric of GRADE_METRICS) expect(metric.denominator.length).toBeGreaterThan(10);
  });

  it('holds the two structural thresholds 0015 argues for, not measures', () => {
    const structural = GRADE_METRICS.filter((m) => m.gate?.kind === 'structural').map((m) => m.id);
    expect(structural).toContain('auth.under-gate-count');
    expect(structural).toContain('narrowing.precision');
    expect(GRADE_METRICS.find((m) => m.id === 'auth.under-gate-count')?.gate).toEqual({
      kind: 'structural', direction: 'atMost', value: 0,
    });
  });

  it('names a suite on every metric, asserted as the complete set both ways', () => {
    // The freeze rule's whole-set form (§13). A metric with no suite would be
    // a number nobody can say what stage it is about, and a declared suite
    // nobody uses is a label with no members — both directions, because
    // `not.toContain` on either one is blind to the other.
    for (const metric of GRADE_METRICS) {
      expect(GradeSuiteIdSchema.options, `${metric.id} names an unknown suite`)
        .toContain(metric.suite);
    }
    expect([...GRADE_SUITES].sort()).toEqual([...GradeSuiteIdSchema.options].sort());
  });

  it('puts `auth` in capture-fidelity, because infer copies the verdict rather than deriving it', () => {
    // The one category 0022 had to decide rather than inherit. `operations.ts`
    // says it in its own words — "the auth verdict is copied, never
    // re-derived. Capture watched the wire; this stage did not" — and 0018 §4
    // had already narrowed the claim to "whether the chain from observation to
    // verdict is faithful". That chain is capture's.
    expect(GRADE_METRICS.filter((m) => m.category === 'auth').map((m) => m.suite))
      .toEqual(Array(5).fill('capture-fidelity'));
  });

  it('labels the one metric that cannot fall, and says what would move it', () => {
    // A rate structurally pinned at 1.000 reads as evidence and is not one.
    // The label has to name the defect that moves it, or the claim is not
    // falsifiable — and a mutation row exercises exactly that defect.
    const labelled = GRADE_METRICS.filter((m) => m.conservation !== undefined);
    expect(labelled.map((m) => m.id)).toEqual(['endpoint-identity.conservation']);
    expect(labelled[0]?.conservation).toMatch(/drops an observed endpoint/);
    // Gated at 1.0 and structural: there is no acceptable rate of losing
    // observed endpoints, so the number follows from the argument rather than
    // from a distribution.
    expect(labelled[0]?.gate).toEqual({ kind: 'structural', direction: 'atLeast', value: 1 });
  });

  it('scores endpoint conservation against what capture observed, not against the spec', () => {
    // The denominator choice that carries the design. Written into the contract
    // as prose because the grader has to match the prose, not the reverse.
    const recall = GRADE_METRICS.find((m) => m.id === 'endpoint-identity.conservation');
    expect(recall?.denominator).toMatch(/CAPTURE OBSERVED/);
  });
});

// ---------------------------------------------------------------------------

const divergence = (category: KnownDivergence['category']): KnownDivergence => ({
  scope: 'endpoint',
  category,
  specPath: '/repos/{owner}/{repo}',
  method: 'GET',
  specSays: 'requires a token',
  serverDoes: 'answers 200 anonymously',
  evidence: {
    request: 'GET /api/v1/repos/o/r (no credentials)',
    responseStatus: 200,
    responseExcerpt: '{"id":1}',
    observedAt: '2026-09-08T00:00:00.000Z',
  },
});

/** A field-scope entry: one slot on one endpoint, not the whole endpoint (0033). */
const fieldDivergence = (pointer: string): KnownDivergence => ({
  ...divergence('narrowing'),
  scope: 'field',
  status: '200',
  pointer,
});

describe('the two divergence scopes are budgeted in their own units (0033)', () => {
  it('does not count field entries against the endpoint cap', () => {
    // Four *fields* against a cap derived from twenty-one *endpoints* is not a
    // threshold that is too tight — it is a ratio between two different things.
    const entries = [1, 2, 3, 4].map((n) => fieldDivergence(`/a${n}`));
    const budget = assessDivergenceBudget(entries, 21, new Map([['narrowing', 9]]));
    expect(budget.overCap).toBe(false);
    expect(budget.perCategory).toEqual([]);
  });

  it('budgets a field entry against its category denominator, and fires', () => {
    const entries = [1, 2, 3, 4].map((n) => fieldDivergence(`/a${n}`));
    const budget = assessDivergenceBudget(entries, 21, new Map([['narrowing', 9]]));
    expect(budget.perCategoryFields).toEqual([
      { category: 'narrowing', count: 4, denominator: 9, cap: 0.45, overCap: true, concentrated: true },
    ]);
    expect(budget.messages.join(' ')).toContain('not fit for grading narrowing');
  });

  it('stays inside the budget on a category large enough to absorb one', () => {
    // The negative case. A rule that fires on every input discriminates nothing
    // — §13's mirror image of the vacuous invariant.
    const budget = assessDivergenceBudget([fieldDivergence('/a')], 21, new Map([['narrowing', 100]]));
    expect(budget.perCategoryFields[0]).toMatchObject({ overCap: false, concentrated: false });
    expect(budget.messages).toEqual([]);
  });

  it('fails closed when the category has no denominator', () => {
    const budget = assessDivergenceBudget([fieldDivergence('/a')], 21, new Map());
    expect(budget.perCategoryFields[0]).toMatchObject({ denominator: 0, overCap: true });
  });
});

describe('known divergence is capped globally and per category', () => {
  it('refuses an entry with no evidence — the justification travels with it', () => {
    const { evidence, ...withoutEvidence } = divergence('auth');
    expect(KnownDivergenceSchema.safeParse(withoutEvidence).success).toBe(false);
    expect(KnownDivergenceSchema.safeParse(divergence('auth')).success).toBe(true);
  });

  /**
   * The real list is empty, so every assertion about it is vacuous unless it is
   * made against a fixture list that trips it. This repo has found that shape
   * five times; catching it here costs one test.
   */
  it('fires on a list concentrated in one category, below the global cap', () => {
    // 100 graded endpoints: a global budget of 5, and 2.5 in any one category.
    const entries = Array.from({ length: 3 }, () => divergence('narrowing'));
    const budget = assessDivergenceBudget(entries, 100);
    expect(budget.overCap).toBe(false);
    expect(budget.concentrated).toEqual(['narrowing']);
    expect(budget.messages.join(' ')).toMatch(/concentrated in narrowing/);
  });

  it('fires on the global cap independently', () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      divergence(GRADE_CATEGORIES[i % GRADE_CATEGORIES.length]!));
    const budget = assessDivergenceBudget(entries, 100); // cap 5, per-category 2.5
    expect(budget.overCap).toBe(true);
    expect(budget.total / 100).toBeGreaterThan(DIVERGENCE_CAP);
  });

  /**
   * The negative case (§13). A budget check that flags every list is the mirror
   * of one that flags none: both are unreadable as working. A list spread thin
   * and under the cap has to come back clean, or `concentrated` is measuring
   * "there are entries" rather than "they are lopsided".
   */
  it('holds still for the same count spread across categories', () => {
    // Same three entries, same 100 graded endpoints, same global budget. The
    // only thing that changed is the distribution — so if this one is flagged
    // too, `concentrated` is measuring "there are entries" and the case above
    // proves nothing.
    const entries = GRADE_CATEGORIES.slice(0, 3).map((category) => divergence(category));
    const budget = assessDivergenceBudget(entries, 100);
    expect(budget.total).toBe(3);
    expect(budget.overCap).toBe(false);
    expect(budget.concentrated).toEqual([]);
    expect(budget.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const REPORT_BASE = {
  artifact: 'stage-report' as const,
  modelVersion: CAPTURE_MODEL_VERSION,
  scrubbed: true as const,
  provenance: { recordedAt: '2026-09-08T00:00:00.000Z', runId: 'run_0123456789abcdef' },
  siteId: 'gitea-local',
  status: 'ok' as const,
  inputs: [],
  outputs: [],
  warnings: [],
  gaps: [],
};

describe("infer's first stage report says what is measured, before any score", () => {
  const detail = {
    stage: 'infer' as const,
    metrics: inferMetricsBlock({ graded: false }),
    authUnknownEndpointIds: [],
  };

  it('parses with the contract attached', () => {
    const report = StageReportSchema.parse({ ...REPORT_BASE, stage: 'infer', detail });
    expect(report.detail?.metrics.graded).toBe(false);
    expect(report.detail?.metrics.metricsVersion).toBe(METRICS_VERSION);
  });

  it('rejects an infer report that omits it', () => {
    const result = StageReportSchema.safeParse({ ...REPORT_BASE, stage: 'infer' });
    expect(result.success, 'an infer report with no scored-field contract parsed').toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/scored-field contract/);
  });

  it('rejects any other stage carrying it', () => {
    const result = StageReportSchema.safeParse({ ...REPORT_BASE, stage: 'capture', detail });
    expect(result.success).toBe(false);
  });

  it('recomputes the category list rather than trusting the report', () => {
    // A reference, not a copy: the same ruling as `manifest.counts.gaps`. A
    // report that restates the categories and drops one does not parse.
    const block = inferMetricsBlock({ graded: false });
    const dropped = { ...block, categories: block.categories.filter((c) => c !== 'auth') };
    expect(InferMetricsBlockSchema.safeParse(dropped).success).toBe(false);
    const reordered = { ...block, categories: [...block.categories].reverse() };
    expect(InferMetricsBlockSchema.safeParse(reordered).success).toBe(false);
  });

  it('rejects a stale digest, which is what makes the freeze mean anything', () => {
    const block = { ...inferMetricsBlock({ graded: false }), contractDigest: 'a'.repeat(64) };
    expect(InferMetricsBlockSchema.safeParse(block).success).toBe(false);
  });

  it('the committed infer fixture is such a report, with no scores in it', () => {
    // `pnpm fixtures` validates on write; this validates on read, so a fixture
    // that drifts from the contract fails `pnpm test` and not only the
    // regeneration nobody runs by hand.
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..', 'fixtures', 'infer', 'northwind-supply', 'stage-report.json',
    );
    const parsed = StageReportSchema.parse(JSON.parse(readFileSync(fixture, 'utf8')));
    expect(parsed.detail?.metrics.graded).toBe(false);
    expect(parsed.detail?.metrics.categories).toEqual([...GRADE_CATEGORIES]);
    // 0014's set, derived rather than declared: `unknown` is narrow, and if
    // this list ever grows the anonymous crawl got shallower.
    expect(parsed.detail?.authUnknownEndpointIds).toEqual(['delete-api-account', 'post-api-checkout']);
  });
});
