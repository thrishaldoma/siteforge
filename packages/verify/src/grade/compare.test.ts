/**
 * The comparability gate and the movement decomposition, driven to every
 * verdict on synthetic reports (decision 0053).
 *
 * §13: a gate takes its inputs as parameters and something other than the real
 * run has to be able to call it. Nothing here reads a file or boots anything.
 */
import { describe, expect, it } from 'vitest';
import {
  GRADE_METRICS,
  seedProgramHash,
  seedStateIdFrom,
  type GradeRun,
  type GradeRunMetric,
  type SeedState,
} from '@siteforge/schema';
import {
  REPORTED_ONLY_POLARITY,
  assessGradeComparability,
  decomposeMovement,
  gatelessMetricIds,
  missesOf,
  polarityOf,
} from './compare.js';

const seedState = (program: string): SeedState => {
  const parts = {
    imageDigest: 'vikunja/vikunja@sha256:ed1f3ed4',
    programHash: seedProgramHash(program),
    account: 'sfadmin',
  };
  return { source: 'fixture-seed', ...parts, id: seedStateIdFrom(parts), label: 'vikunja fixture seed' };
};

const metric = (over: Partial<GradeRunMetric> = {}): GradeRunMetric => ({
  id: 'field-type.accuracy',
  suite: 'capture-fidelity',
  category: 'field-type',
  kind: 'rate',
  numerator: 225,
  denominator: 250,
  value: 0.9,
  vacuous: false,
  gate: { kind: 'calibration', direction: 'atLeast', value: 0.9 },
  passed: true,
  ...over,
});

const run = (over: Partial<GradeRun> = {}): GradeRun => ({
  artifact: 'grade-run',
  provenance: { recordedAt: new Date(0).toISOString(), runId: 'run_0123456789abcdef' },
  siteId: 'vikunja',
  seedState: seedState('seed-a'),
  metricsVersion: 5,
  contractDigest: 'a'.repeat(64),
  metrics: [metric()],
  passed: true,
  failedCategories: [],
  ...over,
});

// ---------------------------------------------------------------------------
// Polarity, and the set that must stay complete
// ---------------------------------------------------------------------------

describe('polarity', () => {
  /**
   * §13's freeze rule in its whole-set form. `not.toContain` on a known-bad
   * entry covers the one someone thought of; equality covers the edge nobody
   * predicted, and this set genuinely moved while the file was being written —
   * the first draft declared six of nine.
   */
  it('declares exactly the gateless metrics, no more and no fewer', () => {
    expect([...REPORTED_ONLY_POLARITY.keys()].sort()).toEqual([...gatelessMetricIds()].sort());
  });

  it('reads a gated metric off its own gate direction', () => {
    expect(polarityOf(metric())).toBe('higher-is-better');
    expect(polarityOf(metric({ id: 'auth.over-gate-rate', gate: { kind: 'calibration', direction: 'atMost', value: 0.2 } })))
      .toBe('lower-is-better');
  });

  it('throws for a metric that is neither gated nor declared', () => {
    expect(() => polarityOf({ id: 'invented.metric', gate: null }))
      .toThrow(/no gate and no declared polarity/);
  });

  it('counts misses as the shortfall where higher is better', () => {
    expect(missesOf(metric())).toBe(25);
  });

  /**
   * The direction actually changing the answer, which is why it cannot be a
   * default: the same numbers read 25 one way and 225 the other.
   */
  it('counts misses as the numerator where lower is better', () => {
    expect(missesOf(metric({
      id: 'auth.over-gate-rate',
      gate: { kind: 'calibration', direction: 'atMost', value: 0.2 },
    }))).toBe(225);
  });
});

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

describe('assessGradeComparability refuses', () => {
  it('across a seed change', () => {
    const result = assessGradeComparability({
      before: run(),
      after: run({ seedState: seedState('seed-b') }),
    });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind)).toEqual(['seed-state-differs']);
    expect(result.refusals[0]?.detail).toContain('what the crawl can');
  });

  it('when either capture recorded no fixture seed', () => {
    const unseeded: SeedState = { source: 'unseeded', reason: 'a live site' };
    const result = assessGradeComparability({ before: run({ seedState: unseeded }), after: run() });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind)).toEqual(['seed-state-unrecorded']);
  });

  it('across a metrics version', () => {
    const result = assessGradeComparability({ before: run(), after: run({ metricsVersion: 6 }) });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind)).toEqual(['metrics-version-differs']);
  });

  it('across a contract digest at the same version', () => {
    const result = assessGradeComparability({ before: run(), after: run({ contractDigest: 'b'.repeat(64) }) });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind)).toEqual(['contract-digest-differs']);
  });

  it('across two targets', () => {
    const result = assessGradeComparability({ before: run(), after: run({ siteId: 'gitea' }) });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind)).toContain('site-differs');
  });

  /**
   * Collected rather than short-circuited: a caller that changed both should be
   * told both, or it fixes one and meets the other on the next run.
   */
  it('reports every reason at once', () => {
    const result = assessGradeComparability({
      before: run(),
      after: run({ siteId: 'gitea', seedState: seedState('seed-b'), metricsVersion: 6 }),
    });
    expect(result.comparable).toBe(false);
    if (result.comparable) return;
    expect(result.refusals.map((r) => r.kind).sort())
      .toEqual(['metrics-version-differs', 'seed-state-differs', 'site-differs']);
  });

  /**
   * **The control** (§13: a harness made only of refusals proves nothing about
   * discrimination). Two reports of one instance, scored by one contract, with
   * *different numbers* — these must compare and render a delta. A gate that
   * refused everything would satisfy every case above.
   */
  it('DOES compare two reports of one instance whose numbers differ', () => {
    const result = assessGradeComparability({
      before: run(),
      after: run({ metrics: [metric({ numerator: 240, denominator: 250, value: 0.96 })] }),
    });
    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]?.numeratorDelta).toBe(15);
    expect(result.movements[0]?.missesDelta).toBe(-15);
  });

  it('names metrics present on only one side', () => {
    const result = assessGradeComparability({
      before: run(),
      after: run({ metrics: [metric({ id: 'narrowing.precision', category: 'narrowing' })] }),
    });
    expect(result.comparable).toBe(true);
    if (!result.comparable) return;
    expect(result.onlyBefore).toEqual(['field-type.accuracy']);
    expect(result.onlyAfter).toEqual(['narrowing.precision']);
  });
});

// ---------------------------------------------------------------------------
// The decomposition
// ---------------------------------------------------------------------------

describe('decomposeMovement', () => {
  /**
   * 0051 §4.2, reproduced exactly: `field-type` 0.9000 (225/250) → 0.9433
   * (416/441), miss count byte-identical at 25. The rate rose, the gate was
   * already met, and nothing improved.
   */
  it('flags a rate that rose while the miss count stayed put', () => {
    const move = decomposeMovement(
      metric(),
      metric({ numerator: 416, denominator: 441, value: 0.9433 }),
    );
    expect(move.missesBefore).toBe(25);
    expect(move.missesAfter).toBe(25);
    expect(move.findings.map((f) => f.kind)).toEqual(['rate-moved-against-its-miss-count']);
  });

  /**
   * The mirror, and it was found by sweeping the record with the rule above:
   * 0046's `response-field-presence.precision` **fell** 0.4538 → 0.4207 with
   * its miss count byte-identical at 325. It read as a regression in two
   * decision documents and is the denominator moving, 595 → 561.
   */
  it('flags a rate that FELL while the miss count stayed put', () => {
    const move = decomposeMovement(
      metric({ id: 'response-field-presence.precision', category: 'response-field-presence', numerator: 270, denominator: 595, value: 0.4538, passed: false }),
      metric({ id: 'response-field-presence.precision', category: 'response-field-presence', numerator: 236, denominator: 561, value: 0.4207, passed: false }),
    );
    expect(move.missesBefore).toBe(325);
    expect(move.missesAfter).toBe(325);
    expect(move.findings.map((f) => f.kind)).toEqual(['rate-moved-against-its-miss-count']);
  });

  /**
   * The control for the symmetric half: a rate that fell **because** more
   * answers are wrong is an honest regression and must produce no finding.
   */
  it('flags NOTHING when a rate fell and the misses actually rose', () => {
    const move = decomposeMovement(
      metric({ numerator: 240, denominator: 250, value: 0.96 }),
      metric({ numerator: 200, denominator: 250, value: 0.8, passed: false }),
    );
    expect(move.missesDelta).toBe(40);
    expect(move.findings).toEqual([]);
  });

  /**
   * 0045 §1.2, the sign flipped: a gate crossed while the denominator
   * *collapsed* 97 → 15. Misses fell, so the flat-miss rule alone would call
   * this a clean pass — which is why the denominator rule carries no threshold
   * and no direction.
   */
  it('flags a gate crossed while the denominator shrank', () => {
    const move = decomposeMovement(
      metric({ id: 'request-field-presence.recall', category: 'request-field-presence', numerator: 50, denominator: 97, value: 0.5155, passed: false }),
      metric({ id: 'request-field-presence.recall', category: 'request-field-presence', numerator: 14, denominator: 15, value: 0.9333, passed: true }),
    );
    expect(move.missesDelta).toBe(-46);
    expect(move.findings.map((f) => f.kind)).toEqual(['gate-crossed-on-a-changed-denominator']);
    expect(move.findings[0]?.detail).toContain('97 → 15');
  });

  /**
   * **The control for the finding set.** A metric that genuinely improved — the
   * same denominator, fewer misses, a gate crossed — must produce *no* finding.
   * Without this the rule could fire on every movement and pass both rows above.
   */
  it('flags NOTHING when a gate is crossed on an unchanged denominator', () => {
    const move = decomposeMovement(
      metric({ numerator: 200, denominator: 250, value: 0.8, passed: false }),
      metric({ numerator: 240, denominator: 250, value: 0.96, passed: true }),
    );
    expect(move.crossedIntoPassing).toBe(true);
    expect(move.findings).toEqual([]);
  });

  it('reports a metric that became vacuous, and one that stopped being', () => {
    const gone = decomposeMovement(metric(), metric({ numerator: 0, denominator: 0, value: null, vacuous: true }));
    expect(gone.findings.map((f) => f.kind)).toContain('vacuity-changed');
    const arrived = decomposeMovement(metric({ numerator: 0, denominator: 0, value: null, vacuous: true }), metric());
    expect(arrived.findings.map((f) => f.kind)).toContain('vacuity-changed');
    expect(arrived.findings[0]?.detail).toContain('first measurement');
  });

  /**
   * A conservation check is a number that can only move via one defect, so its
   * movement is never "an improvement" and never noise (0015 §3).
   */
  it('reports a conservation check moving, with what moves it', () => {
    const conserved = metric({
      id: 'endpoint-identity.conservation',
      category: 'endpoint-identity',
      numerator: 21, denominator: 21, value: 1,
      conservation: 'only a DROPPED endpoint moves it',
    });
    const move = decomposeMovement(conserved, { ...conserved, numerator: 20, value: 0.952, passed: false });
    expect(move.findings.map((f) => f.kind)).toContain('conservation-check-moved');
    expect(move.findings.find((f) => f.kind === 'conservation-check-moved')?.detail)
      .toContain('only a DROPPED endpoint moves it');
  });

  it('does not report a conservation check that held still', () => {
    const conserved = metric({
      id: 'endpoint-identity.conservation', category: 'endpoint-identity',
      numerator: 21, denominator: 21, value: 1, conservation: 'only a DROPPED endpoint moves it',
    });
    expect(decomposeMovement(conserved, { ...conserved }).findings).toEqual([]);
  });

  /** Every metric in the contract can be decomposed — no id throws on polarity. */
  it('can decompose every metric the contract declares', () => {
    for (const m of GRADE_METRICS) {
      const asRun = metric({
        id: m.id,
        category: m.category,
        suite: m.suite,
        gate: m.gate === null ? null : { ...m.gate },
      });
      expect(() => decomposeMovement(asRun, asRun)).not.toThrow();
    }
  });
});
