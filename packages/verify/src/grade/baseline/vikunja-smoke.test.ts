/**
 * The truth side and the grader, before infer's model meets either.
 *
 * Not calibration — the Gitea harness does that with 22 deltas. This answers
 * one question: if the first real score is bad, is it bad because of infer? A
 * truth nobody has graded against and an inference pass nobody has run produce
 * the same wrong number, and there is no way to tell them apart afterwards.
 */
import { describe, expect, it } from 'vitest';
import { gradeSiteModel } from '../grade.js';
import { loadVikunjaTruth } from '../truth/vikunja.js';
import { VIKUNJA_SMOKE, VIKUNJA_SMOKE_OBSERVED } from './vikunja-smoke.js';

const report = gradeSiteModel({
  model: VIKUNJA_SMOKE,
  truth: loadVikunjaTruth(),
  observed: VIKUNJA_SMOKE_OBSERVED,
  divergence: [],
});
const metric = (id: string) => report.metrics.find((m) => m.id === id);

describe('the Vikunja truth grades a model at all', () => {
  it('matches both transcribed operations, with nothing left over', () => {
    expect(report.matching).toEqual({
      matched: 2,
      unmatchedOperations: 0,
      outOfUniverse: 0,
      ambiguous: [],
      arityMismatches: 0,
    });
  });

  it('grounds the categories a two-operation slice can ground', () => {
    expect(metric('endpoint-identity.precision')?.value).toBe(1);
    expect(metric('endpoint-identity.recall')?.value).toBe(1);
    // Non-vacuous over a real denominator: 37 fields walked out of the pinned
    // document and matched by an independent walker.
    const fieldType = metric('field-type.accuracy');
    expect(fieldType?.vacuous).toBe(false);
    expect(fieldType?.denominator).toBeGreaterThan(30);
    expect(fieldType?.value).toBe(1);
    expect(metric('response-field-presence.recall')?.vacuous).toBe(false);
  });

  it('reads both auth verdicts the sweep observed', () => {
    // One public read and one gated read, which is the whole range this API
    // offers — and the reason `auth.over-gate-rate`'s denominator is 1.
    expect(metric('auth.truth-coverage')?.numerator).toBe(2);
    expect(metric('auth.evidence-coverage')?.value).toBe(1);
    expect(metric('auth.over-gate-rate')?.denominator).toBe(1);
  });
});

describe('and reports the rest as ungrounded rather than as a score', () => {
  it('says narrowing is not derived, and why', () => {
    for (const id of ['narrowing.precision', 'narrowing.recall']) {
      expect(metric(id)?.vacuous, id).toBe(true);
      expect(metric(id)?.value, id).toBeNull();
      expect(metric(id)?.emptyDenominator, id).toContain('declares no formats at all');
    }
  });

  it('leaves the parameterless slice vacuous where it has nothing to say', () => {
    // Two zero-parameter GETs: no path parameter names to check and no request
    // bodies. Vacuous is the honest answer, and §6 scores it as an outcome.
    for (const id of [
      'path-param-naming.accuracy',
      'request-field-presence.precision',
      'request-field-presence.recall',
      'synthesized-endpoint.precision',
    ]) {
      expect(metric(id)?.vacuous, id).toBe(true);
    }
  });
});
