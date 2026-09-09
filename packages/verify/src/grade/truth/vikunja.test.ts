/**
 * The Vikunja ground truth, and the two things measurement said about it.
 *
 * Adoption (0021) rests on the browser/document overlap and the prefix
 * universe, both asserted in `browser-surface.test.ts`. This file asserts what
 * the *document* turned out to be, because two of its properties change what
 * the grader can claim and neither was visible before fetching it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assessFormatVocabulary } from '../vocabulary.js';
import { VIKUNJA_TRUTH, loadVikunjaTruth } from './vikunja.js';

const SPEC = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'vikunja', 'docs.json',
);
const truth = loadVikunjaTruth();

describe('the pinned document, read as a truth', () => {
  it('loads the surface the snapshot recorded', () => {
    expect(truth.basePath).toBe('/api/v1');
    expect(truth.counts).toEqual({
      paths: 103,
      operations: 143,
      definitions: 80,
      withPathParams: 86,
      authRequired: 24,
      authNotRequired: 1,
      authIndeterminate: 0,
      authUnobserved: 118,
    });
  });

  it('enumerated response fields for every operation', () => {
    // The floor says "some"; this says all, which is the stronger claim the
    // snapshot actually supports. A $ref resolution regression that spared one
    // operation would pass the floor.
    expect(truth.endpoints.filter((e) => e.responseFields.length === 0)).toEqual([]);
  });

  it('resolves the `allOf: [{ $ref }]` wrappers this generator writes 32 times', () => {
    // The exact count, not a floor: §13 prefers an equality wherever the data
    // allows one, and a committed snapshot does. Under the defect these read
    // **0** and **0** — the document's every closed-domain claim, gone, with
    // `narrowing.recall`'s denominator falling to zero and `response-field-
    // presence.recall` rising because its denominator shrank.
    const enumBearing = (fields: ReadonlyArray<{ enumValues: readonly string[] | null }>) =>
      fields.filter((f) => f.enumValues !== null).length;
    expect(enumBearing(truth.endpoints.flatMap((e) => e.responseFields))).toBe(50);
    expect(enumBearing(truth.endpoints.flatMap((e) => e.requestFields))).toBe(26);

    // And the nested-object half of the same defect: `models.Task.created_by`
    // reaches `user.User` through a wrapper, so its six properties existed only
    // once the wrapper was followed.
    const task = truth.endpoints.find((e) => e.method === 'GET' && e.specPath === '/tasks/{id}');
    expect(task?.responseFields.map((f) => f.pointer)).toContain('/created_by/username');
  });
});

describe('what this document cannot ground, and why', () => {
  it('declares no formats at all — so `narrowing` is not derived from it', () => {
    // Measured, not assumed: zero occurrences of the string in 368KB. Silence
    // about a field is not a claim that the field is unconstrained, so scoring
    // a model's narrowings against it would mark a correct `date-time` on
    // `created` as a false positive for the document's reticence.
    expect(readFileSync(SPEC, 'utf8')).not.toContain('"format"');
    const declared = truth.endpoints
      .flatMap((e) => [...e.responseFields, ...e.requestFields])
      .map((f) => f.format)
      .filter((f): f is string => f !== null);
    expect(declared).toEqual([]);
    expect(assessFormatVocabulary(declared)).toEqual([]);

    const narrowing = truth.notDerived.find((n) => n.category === 'narrowing');
    expect(narrowing?.reason).toContain('declares no formats at all');
  });

  it('and fails the day it starts declaring them, rather than leaving a stale note', () => {
    // The self-unblocking shape. A Vikunja release that annotates its
    // timestamps turns this red and says `narrowing` can be grounded now.
    expect(
      truth.endpoints.flatMap((e) => e.responseFields).filter((f) => f.format !== null),
      'the document now declares formats — narrowing can come off notDerived',
    ).toEqual([]);
  });

  it('names identifier for the same modality reason as every other target', () => {
    expect(truth.notDerived.map((n) => n.category).sort()).toEqual(['identifier', 'narrowing']);
  });
});

describe('an API that gates almost everything', () => {
  it('has exactly one public read, and the floor says so rather than being relaxed', () => {
    const publicReads = truth.endpoints
      .filter((e) => e.auth === 'not-required')
      .map((e) => `${e.method} ${e.specPath}`);
    expect(publicReads).toEqual(['GET /info']);
    // Gitea's floor is >= 5 and this one is >= 1. The difference is the
    // measurement — 24 of 25 zero-parameter GETs answer 401, because Vikunja is
    // a personal task manager — and not a threshold moved to make a target fit.
    const floors = VIKUNJA_TRUTH.floors(truth.counts, truth.endpoints);
    const publicFloor = floors.find(([, message]) => message.includes('no public endpoints'));
    expect(publicFloor?.[0]).toBe(true);
  });

  it('leaves auth.over-gate-rate with a denominator of at most one, and that is reported', () => {
    // A consequence recorded rather than tuned around. §6 scores vacuity as an
    // outcome, so a coarse over-gate metric shows up in the report instead of
    // being hidden by a widened definition.
    expect(truth.counts.authNotRequired).toBeLessThanOrEqual(1);
    expect(VIKUNJA_TRUTH.notDerived.some((n) => n.category === 'auth')).toBe(false);
  });
});
