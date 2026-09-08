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
  GradeCategoryIdSchema,
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

  it('scores endpoint recall against what capture observed, not against the spec', () => {
    // The denominator choice that carries the design. Written into the contract
    // as prose because the grader has to match the prose, not the reverse.
    const recall = GRADE_METRICS.find((m) => m.id === 'endpoint-identity.recall');
    expect(recall?.denominator).toMatch(/CAPTURE OBSERVED/);
  });
});

// ---------------------------------------------------------------------------

const divergence = (category: KnownDivergence['category']): KnownDivergence => ({
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
